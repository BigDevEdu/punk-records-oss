"""Suíte de isolamento (TRD §10) — gate de release.

Tenta quebrar o isolamento lógico entre projetos pelas tools reais sobre um EpochDB real.
Textos são quase idênticos entre projetos e k é grande: sem o filtro, a busca vetorial
traria memórias alheias. NUNCA afrouxe estes testes para fazê-los passar.
"""
import json
import logging
import os
import uuid

import pytest
import yaml
from starlette.testclient import TestClient

from conftest import call_tool
from punk_records.config import SHARED, Agent, Config, ConfigStore, Settings, hash_token
from punk_records import server as server_mod
from punk_records.server import build_app, create_server

pytestmark = pytest.mark.anyio

SETTINGS = Settings(max_k=50)
K = 50


def mk(id, role, projects=()):
    return Agent(id, role, tuple(projects), hash_token(f"tok-{id}"))


A = mk("A", "agent", ["X"])
C = mk("C", "agent", ["X"])
B = mk("B", "agent", ["Y"])
PX = mk("PX", "project_admin", ["X"])
G = mk("G", "global")
NON_GLOBAL = (A, C, B, PX)


class FixedConfig:
    def get(self):
        return Config(frozenset({"X", "Y"}), {a.token_sha256: a for a in (A, C, B, PX, G)})


@pytest.fixture
def server(store):
    return create_server(SETTINGS, FixedConfig(), store)


def note(project):
    return f"Decisão de arquitetura: usamos PostgreSQL com pool de conexões no projeto {project}"


QUERY = "qual banco de dados usamos na arquitetura com pool de conexões"


async def remember(server, who, text, **kw):
    r = await call_tool(server, who, "memory_remember", text=text, **kw)
    assert "error" not in r, r
    return r["id"]


async def query(server, who, **kw):
    kw.setdefault("query", QUERY)
    kw.setdefault("k", K)
    return await call_tool(server, who, "memory_query", **kw)


def projects_of(results):
    assert isinstance(results, list), results
    return {r["project"] for r in results} | {r["metadata"]["project"] for r in results}


# 1
async def test_01_other_project_query_sees_nothing(server):
    x_id = await remember(server, A, note("X"))
    y_id = await remember(server, B, note("Y"))
    rs = await query(server, B, query=note("X"))
    assert x_id not in {r["id"] for r in rs}
    assert projects_of(rs) <= {"Y", SHARED}
    # sanidade: sem filtro (global) a busca de fato traria X — o teste não é vácuo
    assert {x_id, y_id} <= {r["id"] for r in await query(server, G, query=note("X"))}


# 2
async def test_02_explicit_foreign_project_forbidden(server):
    await remember(server, A, note("X"))
    for tool, args in (("memory_query", {"query": QUERY}),
                       ("memory_multi_hop", {"query": QUERY}),
                       ("memory_remember", {"text": note("Y")})):
        assert (await call_tool(server, B, tool, project="X", **args))["error"] == "forbidden"


# 3
async def test_03_same_project_agents_share(server):
    x_id = await remember(server, A, note("X"))
    assert x_id in {r["id"] for r in await query(server, C)}


# 4
async def test_04_everyone_sees_shared(server):
    s_id = await remember(server, A, note("compartilhado"), project=SHARED)
    for who in (A, C, B, PX, G):
        assert s_id in {r["id"] for r in await query(server, who)}, who.id
        assert s_id in {r["id"] for r in await query(server, who, project=SHARED)}, who.id


# 5
async def test_05_global_sees_all_admin_only_own(server):
    x_id = await remember(server, A, note("X"))
    y_id = await remember(server, B, note("Y"))
    g_ids = {r["id"] for r in await query(server, G)}
    assert {x_id, y_id} <= g_ids
    px = await query(server, PX)
    assert x_id in {r["id"] for r in px} and y_id not in {r["id"] for r in px}
    assert projects_of(px) <= {"X", SHARED}
    assert (await query(server, PX, project="Y"))["error"] == "forbidden"


# 6
async def test_06_reserved_metadata_is_overwritten(server, store):
    r = await call_tool(server, A, "memory_remember", text=note("X"),
                        metadata={"project": "Y", "agent_id": "B", "_deleted": True,
                                  "created_by_role": "global", "tag": "ok"})
    assert r["project"] == "X"
    m = store.get(r["id"])
    assert m["project"] == "X" and m["agent_id"] == "A"
    assert m["metadata"]["created_by_role"] == "agent" and m["metadata"]["tag"] == "ok"
    assert "_deleted" not in m["metadata"]
    # e continua visível ao dono, invisível a Y
    assert r["id"] in {x["id"] for x in await query(server, A)}
    assert r["id"] not in {x["id"] for x in await query(server, B)}
    # update também não consegue mudar project/agent_id
    await call_tool(server, A, "memory_update", id=r["id"],
                    metadata={"project": "Y", "agent_id": "B", "_deleted": True})
    m = store.get(r["id"])
    assert m["project"] == "X" and m["agent_id"] == "A" and "_deleted" not in m["metadata"]
    assert r["id"] not in {x["id"] for x in await query(server, B)}


# 7
@pytest.mark.parametrize("filters", [
    {"project": "Y"},
    {"project": {"$in": ["X", "Y"]}},
    {"agent_id": "B"},
    {"created_by_role": "global"},
    {"_deleted": False},
    {"$or": [{"project": "Y"}]},
    {"tag": {"$regex": ".*"}},
    {"tag": {"$or": ["a"]}},
    {"tag": {}},
    {"tag": {"$eq": "a", "$where": "1"}},
])
async def test_07_client_filters_rejected(server, filters):
    await remember(server, B, note("Y"))
    for who in (A, PX, B):
        r = await query(server, who, filters=filters)
        assert isinstance(r, dict) and r["error"] == "invalid", (who.id, r)


async def test_client_filter_cannot_probe_other_project(server):
    await remember(server, A, note("X"), project="X", metadata={"priority": "high"})
    await remember(server, B, note("Y"), project="Y")
    r1 = await query(server, B, filters={"priority": {"$gt": 1}})
    r2 = await query(server, B, filters={"nonexistent": 1})
    assert r1 == [] and r2 == [], (r1, r2)
    own = await query(server, A, filters={"priority": "high"})
    assert isinstance(own, list) and own and projects_of(own) == {"X"}


# 8
async def test_08_context_window_no_foreign_neighbors(server):
    sentinel = f"SENTINEL-Y-{uuid.uuid4()}"
    x1 = await remember(server, A, note("X") + " primeira")
    y = await remember(server, B, note("Y") + " " + sentinel)
    x2 = await remember(server, A, note("X") + " segunda")
    rs = await query(server, A, context_window=2)
    assert {x1, x2} <= {r["id"] for r in rs}
    assert y not in {r["id"] for r in rs}
    for r in rs:
        for n in r["metadata"].get("context_neighbors") or []:
            assert n["metadata"]["project"] != "Y"
            assert n["id"] != y
    assert sentinel not in json.dumps(rs)
    # sanidade: o global vê o vizinho de Y (prova que o pós-filtro é o que protege)
    g = await query(server, G, context_window=2)
    assert any(n["id"] == y for r in g for n in r["metadata"].get("context_neighbors") or [])


# 9
async def test_09_multi_hop_isolated_and_adaptive_forbidden(server):
    sentinel = f"SENTINEL-Y-{uuid.uuid4()}"
    x_id = await remember(server, A, note("X") + " Alice mantém o PostgreSQL")
    y_id = await remember(server, B, note("Y") + f" Alice mantém o PostgreSQL {sentinel}")
    for hops in (1, 2, 3, 5):
        rs = await call_tool(server, A, "memory_multi_hop", query=QUERY, hops=hops, k=K)
        assert x_id in {r["id"] for r in rs}
        assert y_id not in {r["id"] for r in rs}
        assert projects_of(rs) <= {"X", SHARED}
        assert sentinel not in json.dumps(rs)
        # controle positivo: o global alcança y_id pelo mesmo multi_hop
        g = await call_tool(server, G, "memory_multi_hop", query=QUERY, hops=hops, k=K)
        assert y_id in {r["id"] for r in g}
    for who in NON_GLOBAL:
        assert (await call_tool(server, who, "memory_adaptive_query",
                                query=QUERY))["error"] == "forbidden"


# 13
async def test_13_missing_deleted_or_invisible_id_is_not_found(server):
    for tool in ("memory_update", "memory_delete"):
        args = {"text": "x"} if tool == "memory_update" else {}
        assert (await call_tool(server, A, tool, id="nao-existe", **args))["error"] == "not_found"
    # já apagado
    gone = await remember(server, A, note("X"))
    assert (await call_tool(server, A, "memory_delete", id=gone))["deleted"] is True
    assert (await call_tool(server, A, "memory_update", id=gone, text="x"))["error"] == "not_found"
    assert (await call_tool(server, A, "memory_delete", id=gone))["error"] == "not_found"
    assert gone not in {r["id"] for r in await query(server, A)}
    # id de projeto não visível: mesma resposta que inexistente (não revela existência)
    y_id = await remember(server, B, note("Y"))
    def norm(r, id_):
        return json.dumps(r).replace(id_, "<id>")

    for tool in ("memory_update", "memory_delete"):
        args = {"text": "x"} if tool == "memory_update" else {}
        missing = norm(await call_tool(server, A, tool, id="nao-existe", **args), "nao-existe")
        for who in (A, C, PX):
            foreign = await call_tool(server, who, tool, id=y_id, **args)
            assert foreign["error"] == "not_found", (who.id, tool)
            assert norm(foreign, y_id) == missing, (who.id, tool)


# 10
async def test_10_modify_others_forbidden_admin_can(server, store):
    c_id = await remember(server, C, note("X") + " de C")
    assert (await call_tool(server, A, "memory_update", id=c_id, text="hack"))["error"] == "forbidden"
    assert (await call_tool(server, A, "memory_delete", id=c_id))["error"] == "forbidden"
    assert store.get(c_id)["text"] == note("X") + " de C"
    assert await call_tool(server, PX, "memory_update", id=c_id, text="admin editou") == {"id": c_id}
    assert store.get(c_id)["text"] == "admin editou"
    assert (await call_tool(server, PX, "memory_delete", id=c_id))["deleted"] is True
    # admin de X não modifica Y (nem descobre que existe)
    y_id = await remember(server, B, note("Y"))
    assert (await call_tool(server, PX, "memory_update", id=y_id, text="x"))["error"] == "not_found"
    assert (await call_tool(server, PX, "memory_delete", id=y_id))["error"] == "not_found"
    # _shared: só o autor (ou global) modifica; admin de X não é dono do _shared
    s_id = await remember(server, A, note("shared"), project=SHARED)
    for who in (B, C, PX):
        assert (await call_tool(server, who, "memory_update", id=s_id, text="x"))["error"] == "forbidden"
    assert await call_tool(server, G, "memory_update", id=s_id, text="g") == {"id": s_id}


# 11
@pytest.mark.parametrize("tool,args", [
    ("memory_adaptive_query", {"query": QUERY}),
    ("memory_entity_graph", {"entity": "PostgreSQL"}),
    ("memory_timeline", {}),
    ("memory_sql", {"sql": "select 1"}),
    ("memory_compact", {}),
    ("memory_delete", {"id": "qualquer", "hard": True}),
])
async def test_11_global_only_tools_forbidden(server, tool, args):
    for who in NON_GLOBAL:
        assert (await call_tool(server, who, tool, **args))["error"] == "forbidden", who.id


async def test_11b_hard_delete_own_memory_forbidden(server, store):
    x_id = await remember(server, A, note("X"))
    for who in (A, PX):
        assert (await call_tool(server, who, "memory_delete", id=x_id, hard=True))["error"] == "forbidden"
    assert store.get(x_id) is not None


# 15
async def test_15_foreign_id_update_is_not_found(server):
    x_id = await remember(server, A, note("X"))
    assert (await call_tool(server, B, "memory_update", id=x_id, text="x"))["error"] == "not_found"
    assert (await call_tool(server, B, "memory_delete", id=x_id))["error"] == "not_found"


# varredura com sentinela
async def test_sentinel_sweep(server, store):
    sentinel = f"SENTINEL-Y-{uuid.uuid4()}"
    y_id = await remember(server, B, note("Y") + " " + sentinel,
                          metadata={"marker": sentinel}, memory_type="semantic")
    await remember(server, A, note("X"))
    await remember(server, A, note("X") + " outra")
    calls = [("memory_whoami", {})]
    for q in (QUERY, sentinel, note("Y")):
        for cw in (0, 1, 3):
            calls.append(("memory_query", {"query": q, "k": K, "context_window": cw}))
        calls.append(("memory_query", {"query": q, "k": K, "project": "X"}))
        calls.append(("memory_query", {"query": q, "k": K, "project": SHARED}))
        calls.append(("memory_query", {"query": q, "k": K, "filters": {"marker": sentinel}}))
        calls.append(("memory_query", {"query": q, "k": K, "memory_type": "semantic"}))
        for hops in (1, 2, 3):
            calls.append(("memory_multi_hop", {"query": q, "hops": hops, "k": K}))
    calls += [("memory_update", {"id": y_id, "text": "x"}),
              ("memory_update", {"id": y_id, "metadata": {"marker": "x"}}),
              ("memory_delete", {"id": y_id}),
              ("memory_delete", {"id": y_id, "hard": True}),
              ("memory_adaptive_query", {"query": sentinel}),
              ("memory_entity_graph", {"entity": sentinel}),
              ("memory_timeline", {}),
              ("memory_sql", {"sql": "select * from atoms"})]
    for who in (A, C, PX):
        for name, args in calls:
            out = json.dumps(await call_tool(server, who, name, **args))
            assert sentinel not in out, (who.id, name, args)
    # controle positivo: o global encontra a sentinela pelas mesmas consultas
    g = await query(server, G, query=sentinel, filters={"marker": sentinel})
    assert y_id in {r["id"] for r in g} and sentinel in json.dumps(g)
    # nada disso alterou a memória de B
    m = store.get(y_id)
    assert sentinel in m["text"] and m["metadata"]["marker"] == sentinel


# ---------- cada camada de defesa sozinha basta ----------

async def _leak_probe(server):
    """Y grava texto quase idêntico ao de X (+ sentinela); A consulta por todas as vias."""
    sentinel = f"SENTINEL-Y-{uuid.uuid4()}"
    y_id = await remember(server, B, note("Y") + " Alice mantém o PostgreSQL " + sentinel)
    await remember(server, A, note("X") + " Alice mantém o PostgreSQL")
    queries = [QUERY, note("Y"), sentinel]
    outs = []
    for q in queries:
        outs.append(await query(server, A, query=q))
        for hops in (1, 2, 3):
            outs.append(await call_tool(server, A, "memory_multi_hop", query=q, hops=hops, k=K))
    for rs in outs:
        assert isinstance(rs, list), rs
        assert y_id not in {r["id"] for r in rs}
        assert projects_of(rs) <= {"X", SHARED}
        assert sentinel not in json.dumps(rs)


def _no_build_filter(monkeypatch):
    monkeypatch.setattr(server_mod.authz, "build_filter", lambda a, project, cf: {})


def _no_postfilter(monkeypatch):
    monkeypatch.setattr(server_mod.authz, "postfilter", lambda a, rs: (rs, 0))


async def test_postfilter_alone_blocks_leak(server, monkeypatch, caplog):
    """build_filter desligado (filtro vazio): só o pós-filtro protege — e registra a violação."""
    _no_build_filter(monkeypatch)
    caplog.set_level(logging.INFO)
    await _leak_probe(server)
    assert any(r.levelno == logging.CRITICAL and "isolation_violation" in r.getMessage()
               for r in caplog.records)


async def test_build_filter_alone_blocks_leak(server, monkeypatch):
    """postfilter desligado (identidade): só o filtro do EpochDB deveria proteger."""
    _no_postfilter(monkeypatch)
    await _leak_probe(server)


# ---------- via HTTP real (auth por token + ConfigStore) ----------

HDR = {"Accept": "application/json, text/event-stream"}


def write_agents(path, agents):
    path.write_text(yaml.safe_dump({"projects": ["X", "Y"], "agents": [
        {"id": a.id, "role": a.role, "projects": list(a.projects),
         "token_sha256": a.token_sha256, "disabled": a.disabled} for a in agents]}))
    st = os.stat(path)
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))


def rpc(client, token, name, args):
    """tools/call via HTTP; devolve (status, resultado JSON | None)."""
    h = HDR | {"Authorization": f"Bearer {token}"}
    init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-06-18", "capabilities": {},
        "clientInfo": {"name": "t", "version": "0"}}}
    r = client.post("/mcp", json=init, headers=h)
    if r.status_code != 200:
        return r.status_code, None
    r = client.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                                  "params": {"name": name, "arguments": args}}, headers=h)
    body = r.text
    if r.headers.get("content-type", "").startswith("text/event-stream"):
        body = next(ln[5:] for ln in body.splitlines() if ln.startswith("data:"))
    res = json.loads(body)["result"]
    if res.get("structuredContent") is not None:
        return r.status_code, res["structuredContent"]["result"]
    return r.status_code, json.loads(res["content"][0]["text"])


@pytest.fixture
def live(store, tmp_path):
    path = tmp_path / "agents.yaml"
    write_agents(path, (A, C, B, PX, G))
    with TestClient(build_app(SETTINGS, ConfigStore(str(path)), store)) as c:
        yield c, path


# 12
def test_12_token_absent_invalid_revoked_401(live):
    c, path = live
    assert rpc(c, "tok-A", "memory_whoami", {})[0] == 200
    assert c.post("/mcp", json={}, headers=HDR).status_code == 401
    for bad in ("Bearer ", "Bearer nope", "Bearer tok-a", "Basic tok-A", "tok-A",
                f"Bearer {A.token_sha256}"):
        r = c.post("/mcp", json={}, headers=HDR | {"Authorization": bad})
        assert r.status_code == 401 and r.json() == {"error": "unauthorized"}, bad
    # revogado: disabled no yaml, observado ao vivo
    write_agents(path, (Agent(A.id, A.role, A.projects, A.token_sha256, True), C, B, PX, G))
    assert rpc(c, "tok-A", "memory_whoami", {})[0] == 401
    assert rpc(c, "tok-C", "memory_whoami", {})[0] == 200
    # revogado: removido do yaml
    write_agents(path, (B, PX, G))
    assert rpc(c, "tok-C", "memory_query", {"query": QUERY})[0] == 401
    assert rpc(c, "tok-B", "memory_whoami", {})[0] == 200


# 14
def test_14_project_removed_from_token_live(live):
    c, path = live
    status, r = rpc(c, "tok-A", "memory_remember", {"text": note("X")})
    assert status == 200 and r["project"] == "X"
    x_id = r["id"]
    status, rs = rpc(c, "tok-A", "memory_query", {"query": QUERY, "k": K})
    assert x_id in {m["id"] for m in rs}
    # tira X de A (A passa para Y), sem reiniciar
    write_agents(path, (Agent("A", "agent", ("Y",), A.token_sha256), C, B, PX, G))
    status, rs = rpc(c, "tok-A", "memory_query", {"query": QUERY, "k": K})
    assert status == 200 and x_id not in {m["id"] for m in rs}
    assert projects_of(rs) <= {"Y", SHARED}
    assert rpc(c, "tok-A", "memory_query", {"query": QUERY, "project": "X"})[1]["error"] == "forbidden"
    assert rpc(c, "tok-A", "memory_update", {"id": x_id, "text": "x"})[1]["error"] == "not_found"
    assert rpc(c, "tok-A", "memory_whoami", {})[1]["projects"] == ["Y"]
