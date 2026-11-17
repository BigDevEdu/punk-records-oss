import json
import logging

import pytest
from starlette.testclient import TestClient

from conftest import call_tool
from punk_records.config import Agent, ConfigStore, Settings, hash_token
from punk_records.server import build_app, create_server

pytestmark = pytest.mark.anyio

SETTINGS = Settings(max_k=3)


def mk(id, role, projects=(), token=None, disabled=False):
    return Agent(id, role, tuple(projects), hash_token(token or id), disabled)


A = mk("a", "agent", ["alpha"])
B = mk("b", "agent", ["beta"])
G = mk("g", "global")
ADMIN = mk("adm", "project_admin", ["alpha"])


class FakeConfig:
    def __init__(self, *agents, projects=("alpha", "beta")):
        from punk_records.config import Config
        self.c = Config(frozenset(projects), {a.token_sha256: a for a in agents})

    def get(self):
        return self.c


@pytest.fixture
def server(store):
    return create_server(SETTINGS, FakeConfig(A, B, G, ADMIN), store)


def http(store, *agents):
    return TestClient(build_app(SETTINGS, FakeConfig(*agents), store))


def test_healthz_no_auth(store):
    with http(store, A) as c:
        assert c.get("/healthz").status_code == 200


def test_missing_token_401(store):
    with http(store, A) as c:
        r = c.post("/mcp", json={})
        assert r.status_code == 401 and r.json() == {"error": "unauthorized"}
        assert c.post("/mcp", json={}, headers={"Authorization": "Bearer nope"}).status_code == 401


def test_disabled_token_401(store):
    with http(store, mk("x", "agent", ["alpha"], disabled=True)) as c:
        assert c.post("/mcp", json={}, headers={"Authorization": "Bearer x"}).status_code == 401


def test_whoami_over_http(store):
    hdr = {"Authorization": "Bearer a", "Accept": "application/json, text/event-stream"}
    with http(store, A) as c:
        init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "t", "version": "0"}}}
        assert c.post("/mcp", json=init, headers=hdr).status_code == 200
        call = {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                "params": {"name": "memory_whoami", "arguments": {}}}
        r = c.post("/mcp", json=call, headers=hdr)
        assert r.status_code == 200 and "agent_id" in r.text and "alpha" in r.text


async def test_global_sql_runs(server):
    # duckdb é extra opcional do EpochDB; sem ele memory_sql quebrava em produção.
    assert isinstance(await call_tool(server, G, "memory_sql", sql="select 1"), list)


async def test_whoami(server):
    assert await call_tool(server, A, "memory_whoami") == {
        "agent_id": "a", "role": "agent", "projects": ["alpha"], "shared": "_shared"}


async def test_remember_stamps_agent_and_project(server, store):
    r = await call_tool(server, A, "memory_remember", text="usamos pytest",
                        metadata={"agent_id": "evil", "project": "beta", "tag": "x"})
    assert r["project"] == "alpha"
    m = store.get(r["id"])
    assert m["project"] == "alpha" and m["agent_id"] == "a"
    assert m["metadata"]["tag"] == "x"


async def test_remember_foreign_project_forbidden(server):
    r = await call_tool(server, A, "memory_remember", text="x", project="beta")
    assert r["error"] == "forbidden"


async def test_empty_text_invalid(server):
    assert (await call_tool(server, A, "memory_remember", text="  "))["error"] == "invalid"
    assert (await call_tool(server, A, "memory_query", query=""))["error"] == "invalid"


async def test_k_clamped(server):
    for i in range(6):
        await call_tool(server, A, "memory_remember", text=f"nota numero {i} sobre cafe")
    assert len(await call_tool(server, A, "memory_query", query="cafe", k=1000)) <= 3
    assert len(await call_tool(server, A, "memory_query", query="cafe", k=0)) == 1


@pytest.mark.parametrize("tool,args", [
    ("memory_adaptive_query", {"query": "x"}),
    ("memory_entity_graph", {"entity": "x"}),
    ("memory_timeline", {}),
    ("memory_sql", {"sql": "select 1"}),
    ("memory_compact", {}),
    ("memory_delete", {"id": "whatever", "hard": True}),
])
async def test_global_only_tools_forbidden_for_agent(server, tool, args):
    for who in (A, ADMIN):
        assert (await call_tool(server, who, tool, **args))["error"] == "forbidden"


async def test_isolation_query_and_update_delete(server, store):
    r = await call_tool(server, B, "memory_remember", text="segredo da beta")
    assert await call_tool(server, A, "memory_query", query="segredo") == []
    assert (await call_tool(server, A, "memory_update", id=r["id"], text="x"))["error"] == "not_found"
    assert (await call_tool(server, A, "memory_delete", id=r["id"]))["error"] == "not_found"
    assert (await call_tool(server, A, "memory_update", id="nope", text="x"))["error"] == "not_found"


async def test_update_cannot_change_project(server, store):
    r = await call_tool(server, A, "memory_remember", text="original")
    out = await call_tool(server, A, "memory_update", id=r["id"], text="novo texto",
                          metadata={"project": "beta", "agent_id": "g", "_x": 1, "ok": 1})
    assert out == {"id": r["id"]}
    m = store.get(r["id"])
    assert m["project"] == "alpha" and m["agent_id"] == "a"
    assert m["metadata"]["ok"] == 1 and "_x" not in m["metadata"]


async def test_agent_cannot_modify_others_but_admin_can(server, store):
    r = await call_tool(server, A, "memory_remember", text="de a", project="_shared")
    assert (await call_tool(server, B, "memory_update", id=r["id"], text="x"))["error"] == "forbidden"
    r2 = await call_tool(server, A, "memory_remember", text="do alpha")
    assert (await call_tool(server, ADMIN, "memory_update", id=r2["id"], text="y")) == {"id": r2["id"]}
    assert (await call_tool(server, G, "memory_delete", id=r2["id"], hard=True))["deleted"] is True


async def test_audit_line_has_no_text(server, caplog):
    caplog.set_level(logging.INFO)
    await call_tool(server, A, "memory_remember", text="texto ultrassecreto")
    assert "ultrassecreto" not in caplog.text
    line = next(r.message for r in caplog.records if r.name == "punk_records.audit")
    d = json.loads(line)
    assert d["agent_id"] == "a" and d["tool"] == "memory_remember" and d["outcome"] == "ok"


async def test_unexpected_error_audited_as_error(server, store, monkeypatch, caplog):
    def boom(*a, **k):
        raise RuntimeError("falha")
    monkeypatch.setattr(store, "query", boom)
    caplog.set_level(logging.INFO)
    with pytest.raises(Exception):
        await call_tool(server, A, "memory_query", query="textosecreto")
    d = json.loads(next(r.message for r in caplog.records if r.name == "punk_records.audit"))
    assert d["outcome"] == "error"
    assert "textosecreto" not in caplog.text


async def test_context_neighbors_cannot_be_written(server, store):
    r = await call_tool(server, A, "memory_remember", text="abc def ghi",
                        metadata={"context_neighbors": [{"x": 1}], "k": 1})
    await call_tool(server, A, "memory_update", id=r["id"], text="novo texto",
                    metadata={"context_neighbors": [{"x": 2}]})
    assert "context_neighbors" not in store.get(r["id"])["metadata"]


async def test_invalid_memory_type_rejected(server):
    out = await call_tool(server, A, "memory_remember", text="x", memory_type="test")
    assert out["error"] == "invalid" and "episodic" in out["detail"]
    out = await call_tool(server, A, "memory_query", query="x", memory_type="test")
    assert out["error"] == "invalid"


async def test_valid_memory_type_kept(server, store):
    r = await call_tool(server, A, "memory_remember", text="fato", memory_type="episodic")
    assert store.get(r["id"])["memory_type"] == "episodic"


async def test_update_keeps_original_created_at(server, store):
    r = await call_tool(server, A, "memory_remember", text="primeira versão",
                        metadata={"created_at": 1.0})
    before = store.get(r["id"])
    assert before["created_at"] != 1.0  # cliente não define a data
    await call_tool(server, A, "memory_update", id=r["id"], text="segunda versão",
                    metadata={"created_at": 2.0})
    after = store.get(r["id"])
    assert after["text"] == "segunda versão"
    assert after["created_at"] == before["created_at"]
    assert after["updated_at"] >= after["created_at"]


async def test_sql_error_returns_message(server, store, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("Parser Error: syntax error at or near FROMM")
    monkeypatch.setattr(store, "sql", boom)
    out = await call_tool(server, G, "memory_sql", sql="select * fromm x")
    assert out["error"] == "invalid" and "FROMM" in out["detail"]


async def test_sql_sees_archived_memories(server, store):
    await call_tool(server, A, "memory_remember", text="arquivada")
    store.db.flush()
    out = await call_tool(server, G, "memory_sql", sql="select count(*) as n from cold_tier")
    assert out == [{"n": 1}]


async def test_sql_cannot_touch_files(server, store, tmp_path):
    secret = tmp_path / "segredo.txt"
    secret.write_text("token_hash")
    await call_tool(server, A, "memory_remember", text="x")
    store.db.flush()
    out = await call_tool(server, G, "memory_sql", sql=f"select content from read_text('{secret}')")
    assert out["error"] == "invalid" and "token_hash" not in str(out)
    target = tmp_path / "escrito.csv"
    out = await call_tool(server, G, "memory_sql", sql=f"copy (select 42) to '{target}'")
    assert out["error"] == "invalid" and not target.exists()
    out = await call_tool(server, G, "memory_sql", sql="set enable_external_access = true")
    assert out["error"] == "invalid"


async def test_hard_delete_after_soft_delete(server, store):
    r = await call_tool(server, A, "memory_remember", text="apagar duas vezes")
    assert await call_tool(server, A, "memory_delete", id=r["id"]) == {"id": r["id"], "deleted": True}
    out = await call_tool(server, G, "memory_delete", id=r["id"], hard=True)
    assert out == {"id": r["id"], "deleted": True}
    assert store.find(r["id"]) is None


async def test_hard_delete_archived_soft_deleted_hidden_from_sql(server, store):
    r = await call_tool(server, A, "memory_remember", text="arquivada e apagada")
    store.db.flush()
    await call_tool(server, A, "memory_delete", id=r["id"])
    assert (await call_tool(server, G, "memory_delete", id=r["id"], hard=True))["deleted"]
    out = await call_tool(server, G, "memory_sql", sql=f"select id from cold_tier where id = '{r['id']}'")
    assert out == []


async def test_hard_delete_missing_is_not_found(server):
    out = await call_tool(server, G, "memory_delete", id="nao-existe", hard=True)
    assert out["error"] == "not_found"
