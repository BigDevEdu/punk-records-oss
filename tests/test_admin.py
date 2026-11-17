import dataclasses
import json
import time

import pytest
from starlette.testclient import TestClient

from punk_records import admin
import yaml

from punk_records.activity import ActivityLog
from punk_records.config import Config, ConfigStore, hash_token
from punk_records.server import build_app
from test_server import SETTINGS, mk

G = mk("g", "global")
A = mk("a", "agent", ["alpha"])
OFF = mk("off", "global", disabled=True)
LOGIN_FAIL = "Esse token não tem papel global. Use um token de administrador."


class MutableConfig:
    def __init__(self, *agents):
        self.set(*agents)

    def set(self, *agents):
        self.c = Config(frozenset({"alpha"}), {a.token_sha256: a for a in agents})

    def get(self):
        return self.c


@pytest.fixture(autouse=True)
def no_delay(monkeypatch):
    monkeypatch.setattr(admin, "LOGIN_FAIL_DELAY", 0)
    monkeypatch.delenv("PR_ADMIN_INSECURE_COOKIE", raising=False)


@pytest.fixture
def web(tmp_path):
    d = tmp_path / "web"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text("<html>spa</html>")
    (d / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("nao")
    return d


@pytest.fixture
def cfg():
    return MutableConfig(G, A, OFF)


@pytest.fixture
def client(store, cfg, web):
    with TestClient(build_app(SETTINGS, cfg, store, web_dir=str(web)),
                    base_url="https://testserver") as c:
        yield c


def login(c, token):
    return c.post("/admin/api/login", json={"token": token})


def test_login_global_ok_sets_cookie_flags(client):
    r = login(client, "g")
    assert r.status_code == 200 and r.json() == {"agent_id": "g", "role": "global"}
    sc = r.headers["set-cookie"].lower()
    assert sc.startswith("pr_session=")
    for flag in ("httponly", "secure", "samesite=strict", "path=/admin", "max-age=43200"):
        assert flag in sc
    assert client.get("/admin/api/me").json() == {"agent_id": "g", "role": "global"}


def test_login_agent_role_rejected(client):
    for body in ({"token": "a"}, {"token": "nope"}, {"token": 1}, {}):
        r = client.post("/admin/api/login", json=body)
        assert r.status_code == 401
        assert r.json() == {"error": "unauthorized", "detail": LOGIN_FAIL}
        assert "set-cookie" not in r.headers


def test_login_disabled_rejected(client):
    r = login(client, "off")
    assert r.status_code == 401 and r.json()["detail"] == LOGIN_FAIL


def test_login_failure_waits(client, monkeypatch):
    slept = []

    async def fake_sleep(s):
        slept.append(s)

    monkeypatch.setattr(admin, "LOGIN_FAIL_DELAY", 0.5)
    monkeypatch.setattr(admin.anyio, "sleep", fake_sleep)
    login(client, "a")
    login(client, "g")
    assert slept == [0.5]


def test_api_without_session_401(client):
    for path in ("/admin/api/me",):
        r = client.get(path)
        assert r.status_code == 401 and r.json()["error"] == "unauthorized"
    client.cookies.set("pr_session", "forjado", path="/admin")
    assert client.get("/admin/api/me").status_code == 401


def test_bearer_header_does_not_open_admin(client):
    r = client.get("/admin/api/me", headers={"Authorization": "Bearer g"})
    assert r.status_code == 401


def test_mcp_still_requires_bearer(client):
    login(client, "g")  # cookie de sessão não abre o MCP
    r = client.post("/mcp", json={})
    assert r.status_code == 401 and r.json() == {"error": "unauthorized"}
    assert client.post("/adminx", json={}).status_code == 401


def test_session_dies_when_agent_revoked(client, cfg):
    login(client, "g")
    assert client.get("/admin/api/me").status_code == 200
    cfg.set(dataclasses.replace(G, disabled=True), A)
    assert client.get("/admin/api/me").status_code == 401
    cfg.set(dataclasses.replace(G, role="agent"), A)
    assert client.get("/admin/api/me").status_code == 401
    cfg.set(A)
    assert client.get("/admin/api/me").status_code == 401
    cfg.set(G, A)  # voltou a ser global: sessão ainda válida
    assert client.get("/admin/api/me").status_code == 200


def test_session_expires():
    t = [1000.0]
    s = admin.Sessions(ttl=10, now=lambda: t[0])
    sid = s.create("g")
    assert s.get(sid) == "g" and s.get("outro") is None and s.get(None) is None
    t[0] = 1009.9
    assert s.get(sid) == "g"
    t[0] = 1010.0
    assert s.get(sid) is None
    sid2 = s.create("g")
    s.drop(sid2)
    assert s.get(sid2) is None


def test_logout_drops_session(client):
    login(client, "g")
    r = client.post("/admin/api/logout", json={})
    assert r.status_code == 200
    client.cookies.clear()
    # o sid antigo não vale mais mesmo se reapresentado
    assert client.get("/admin/api/me").status_code == 401


def test_logout_invalidates_server_side(client):
    login(client, "g")
    sid = client.cookies.get("pr_session")
    client.post("/admin/api/logout", json={})
    client.cookies.set("pr_session", sid, path="/admin")
    assert client.get("/admin/api/me").status_code == 401


def test_mutation_requires_json(client):
    login(client, "g")
    r = client.post("/admin/api/logout", content="x", headers={"Content-Type": "text/plain"})
    assert r.status_code == 400 and r.json()["error"] == "invalid"
    assert client.get("/admin/api/me").status_code == 200  # não deslogou
    r = client.post("/admin/api/login", content='{"token": "g"}',
                    headers={"Content-Type": "text/plain"})
    assert r.status_code == 400 and r.json()["error"] == "invalid"
    r = client.post("/admin/api/login", content="{",
                    headers={"Content-Type": "application/json"})
    assert r.status_code == 400 and r.json()["error"] == "invalid"


def test_spa_fallback_serves_index(client):
    for path in ("/admin", "/admin/", "/admin/agentes"):
        r = client.get(path)
        assert r.status_code == 200 and r.text == "<html>spa</html>", path
    assert client.get("/admin/assets/app.js").text == "console.log(1)"
    r = client.get("/admin/api/nao-existe")
    assert r.status_code == 404 and r.json()["error"] == "not_found"


def test_spa_no_path_traversal(client):
    for path in ("/admin/../secret.txt", "/admin/%2e%2e/secret.txt", "/admin/assets/..%2f..%2fsecret.txt"):
        r = client.get(path)
        assert "nao" != r.text, path


def test_spa_not_built(store, cfg, tmp_path):
    with TestClient(build_app(SETTINGS, cfg, store, web_dir=str(tmp_path / "x"))) as c:
        r = c.get("/admin/agentes")
        assert r.status_code == 404
        assert r.json() == {"error": "not_found", "detail": "painel não foi buildado"}


def test_insecure_cookie_env(store, cfg, web, monkeypatch):
    monkeypatch.setenv("PR_ADMIN_INSECURE_COOKIE", "1")
    with TestClient(build_app(SETTINGS, cfg, store, web_dir=str(web))) as c:
        r = login(c, "g")
        assert r.status_code == 200 and "secure" not in r.headers["set-cookie"].lower()
        assert c.get("/admin/api/me").status_code == 200


# ---- minors da Task 4 ----

def test_missing_asset_and_bare_api_404_json(client):
    for path in ("/admin/assets/nada.js", "/admin/api"):
        r = client.get(path)
        assert r.status_code == 404 and r.json()["error"] == "not_found", path


def test_login_drops_previous_session(client):
    login(client, "g")
    old = client.cookies.get("pr_session")
    login(client, "g")
    assert client.cookies.get("pr_session") != old
    client.cookies.clear()
    client.cookies.set("pr_session", old, path="/admin")
    assert client.get("/admin/api/me").status_code == 401


# ---- rotas de dados (Task 5) ----

def agents_yaml(path):
    ag = lambda i, role, projs: {"id": i, "role": role, "projects": projs,
                                 "token_sha256": hash_token(i)}
    path.write_text(yaml.safe_dump({"projects": ["alpha", "beta", "vazio"], "agents": [
        ag("g", "global", []), ag("a", "agent", ["alpha"]), ag("b", "agent", ["beta"])]}))


@pytest.fixture
def env(store, tmp_path, web):
    f = tmp_path / "agents.yaml"
    agents_yaml(f)
    act = ActivityLog(str(tmp_path / "audit.jsonl"))
    settings = dataclasses.replace(SETTINGS, agents_file=str(f))
    app = build_app(settings, ConfigStore(str(f)), store, act, web_dir=str(web))
    with TestClient(app, base_url="https://testserver") as c:
        login(c, "g")
        c.act, c.file = act, f
        yield c


def mem(store, text, project, agent="a"):
    return store.remember(text, {"project": project, "agent_id": agent,
                                 "created_at": time.time()}, None)


def req(c, method, url, body=None):
    return c.request(method, url, json=body if body is not None else {})


TXT = "Decisão: usamos PostgreSQL com pool de conexões no projeto"


def test_graph_as_agent_hides_other_project(env, store):
    ia, ib = mem(store, TXT + " alpha", "alpha"), mem(store, TXT + " beta", "beta", "b")
    ids = lambda r: {n["id"] for n in r.json()["nodes"]}
    assert ids(env.get("/admin/api/graph")) == {ia, ib}
    r = env.get("/admin/api/graph?as=b&min_sim=0.3")
    assert ids(r) == {ib} and r.json()["edges"] == []
    assert env.get("/admin/api/graph?as=zzz").status_code == 404


def test_graph_params_clamped(env, store):
    mem(store, TXT + " alpha", "alpha")
    mem(store, TXT + " beta", "beta")
    assert env.get("/admin/api/graph?k=x").status_code == 400
    seen = []
    import punk_records.admin as ad
    orig = ad.build_graph
    ad.build_graph = lambda *a, **kw: seen.append((kw["k"], kw["min_sim"])) or orig(*a, **kw)
    try:
        env.get("/admin/api/graph?k=999&min_sim=0")
        env.get("/admin/api/graph?k=-3&min_sim=5")
    finally:
        ad.build_graph = orig
    assert seen == [(10, 0.3), (1, 0.95)]
    assert env.get("/admin/api/graph?k=999&min_sim=0").status_code == 200


def test_search_as_agent_scoped(env, store):
    mem(store, TXT + " alpha", "alpha")
    ib = mem(store, TXT + " beta", "beta", "b")
    q = "?q=PostgreSQL pool de conexões&k=10"
    assert {x["id"] for x in env.get("/admin/api/search" + q).json()} >= {ib}
    r = env.get("/admin/api/search" + q + "&as=b").json()
    assert [x["id"] for x in r] == [ib] and set(r[0]) == {"id", "score"}
    assert env.get("/admin/api/search?q=").status_code == 400


def test_memory_detail_as_invisible_not_found(env, store):
    ia, ib = mem(store, TXT + " alpha", "alpha"), mem(store, TXT + " beta", "beta", "b")
    r = env.get(f"/admin/api/memories/{ia}")
    assert r.status_code == 200 and r.json()["text"].endswith("alpha")
    assert [s["id"] for s in r.json()["similar"]] == [ib]
    assert env.get(f"/admin/api/memories/{ia}?as=b").status_code == 404
    assert env.get(f"/admin/api/memories/{ia}?as=a").status_code == 200
    assert env.get("/admin/api/memories/inexistente").status_code == 404


def test_patch_delete_reject_as(env, store):
    i = mem(store, TXT + " alpha", "alpha")
    assert req(env, "PATCH", f"/admin/api/memories/{i}?as=a", {"text": "x"}).status_code == 400
    assert req(env, "DELETE", f"/admin/api/memories/{i}?as=a").status_code == 400
    assert env.get(f"/admin/api/memories/{i}").status_code == 200


def test_patch_and_delete_memory(env, store):
    i = mem(store, TXT + " alpha", "alpha")
    r = req(env, "PATCH", f"/admin/api/memories/{i}",
            {"text": "novo texto", "metadata": {"project": "beta", "tag": "t"}})
    assert r.status_code == 200
    m = env.get(f"/admin/api/memories/{i}").json()
    assert m["text"] == "novo texto" and m["project"] == "alpha"
    assert m["metadata"]["tag"] == "t"
    assert req(env, "PATCH", f"/admin/api/memories/{i}", {}).status_code == 400
    assert req(env, "PATCH", "/admin/api/memories/nope", {"text": "x"}).status_code == 404
    assert req(env, "DELETE", f"/admin/api/memories/{i}").status_code == 200
    assert env.get(f"/admin/api/memories/{i}").status_code == 404
    assert req(env, "DELETE", f"/admin/api/memories/{i}?hard=true").status_code == 200
    assert req(env, "DELETE", f"/admin/api/memories/{i}?hard=true").status_code == 404


def test_projects_counts_and_color(env, store):
    mem(store, "um", "alpha")
    mem(store, "dois", "alpha")
    mem(store, "tres", "_shared")
    assert env.get("/admin/api/projects").json() == [
        {"name": "alpha", "count": 2, "color_index": 0},
        {"name": "beta", "count": 0, "color_index": 1},
        {"name": "vazio", "count": 0, "color_index": 2},
        {"name": "_shared", "count": 1, "color_index": 3}]


def test_agents_list_has_usage(env, store):
    mem(store, "um", "alpha", "a")
    env.act._write(json.dumps({"ts": 5.0, "agent_id": "a"}))
    rows = {a["id"]: a for a in env.get("/admin/api/agents").json()}
    assert rows["a"] == {"id": "a", "role": "agent", "projects": ["alpha"], "disabled": False,
                         "last_used_at": 5.0, "memory_count": 1}
    assert rows["b"]["last_used_at"] is None and rows["b"]["memory_count"] == 0


def test_create_agent_returns_token_once(env):
    r = req(env, "POST", "/admin/api/agents", {"id": "novo", "role": "agent", "projects": ["gama"]})
    tok = r.json()["token"]
    assert r.status_code == 200 and tok.startswith("pr_")
    body = env.get("/admin/api/agents").text
    assert tok not in body and hash_token(tok) not in body and "token" not in body
    assert "gama" in env.get("/admin/api/projects").text
    assert req(env, "POST", "/admin/api/agents", {"id": "Ruim!", "role": "agent",
                                                  "projects": []}).status_code == 400


def test_create_duplicate_invalid(env):
    r = req(env, "POST", "/admin/api/agents", {"id": "a", "role": "agent", "projects": []})
    assert r.status_code == 400 and r.json()["error"] == "invalid"


def test_update_agent_and_errors(env):
    r = req(env, "PATCH", "/admin/api/agents/a", {"disabled": True, "projects": ["beta"]})
    assert r.status_code == 200
    a = next(x for x in env.get("/admin/api/agents").json() if x["id"] == "a")
    assert a["disabled"] is True and a["projects"] == ["beta"]
    assert req(env, "PATCH", "/admin/api/agents/a", {"role": "xx"}).status_code == 400
    assert req(env, "PATCH", "/admin/api/agents/zz", {"disabled": True}).status_code == 404
    assert req(env, "POST", "/admin/api/agents/zz/token").status_code == 404
    assert req(env, "DELETE", "/admin/api/agents/zz").status_code == 404
    assert req(env, "DELETE", "/admin/api/agents/b").status_code == 200
    assert {x["id"] for x in env.get("/admin/api/agents").json()} == {"g", "a"}


def test_agents_file_missing(store, tmp_path, web):
    f = str(tmp_path / "nada.yaml")
    cs = ConfigStore(f)
    cs._config = Config(frozenset(), {G.token_sha256: G})  # só para logar; arquivo não existe
    st = dataclasses.replace(SETTINGS, agents_file=f)
    with TestClient(build_app(st, cs, store, web_dir=str(web)), base_url="https://testserver") as c:
        login(c, "g")
        for m, u in (("PATCH", "/admin/api/agents/x"), ("POST", "/admin/api/agents/x/token"),
                     ("DELETE", "/admin/api/agents/x")):
            assert req(c, m, u, {"disabled": True}).status_code == 404


def test_cannot_lock_self_out(env):
    for m, u, b in (("PATCH", "/admin/api/agents/g", {"disabled": True}),
                    ("DELETE", "/admin/api/agents/g", None),
                    ("PATCH", "/admin/api/agents/g", {"role": "agent"}),
                    ("POST", "/admin/api/agents/g/token", None)):
        r = req(env, m, u, b)
        assert r.status_code == 403 and r.json() == {
            "error": "forbidden", "detail": "Você não pode alterar o agente da sua própria sessão."}
    assert req(env, "PATCH", "/admin/api/agents/g", {"projects": [], "role": "global"}).status_code == 200
    assert env.get("/admin/api/me").status_code == 200


def test_rotate_old_token_stops_working(env):
    old = {"Authorization": "Bearer a"}
    assert env.post("/mcp", json={}, headers=old).status_code != 401
    tok = req(env, "POST", "/admin/api/agents/a/token").json()["token"]
    assert env.post("/mcp", json={}, headers=old).status_code == 401
    assert env.post("/mcp", json={}, headers={"Authorization": f"Bearer {tok}"}).status_code != 401


def test_activity_lists_recent(env):
    for i in range(3):
        env.act._write(json.dumps({"ts": i, "agent_id": "a" if i else "b", "tool": f"t{i}"}))
    r = env.get("/admin/api/activity?limit=2").json()
    assert [x["tool"] for x in r] == ["t2", "t1"]
    assert [x["tool"] for x in env.get("/admin/api/activity?agent=b").json()] == ["t0"]
    assert env.get("/admin/api/activity?limit=x").status_code == 400


def test_admin_mutation_audited_without_token(env, store, caplog):
    i = mem(store, "texto secreto da memória", "alpha")
    with caplog.at_level("INFO", logger="punk_records.audit"):
        tok = req(env, "POST", "/admin/api/agents",
                  {"id": "novo", "role": "agent", "projects": []}).json()["token"]
        req(env, "PATCH", f"/admin/api/memories/{i}", {"text": "outro texto secreto"})
        req(env, "DELETE", "/admin/api/agents/g")
    lines = [json.loads(r.getMessage()) for r in caplog.records if r.name == "punk_records.audit"]
    assert [(l["tool"], l["ids"], l["outcome"]) for l in lines] == [
        ("admin.agent.create", ["novo"], "ok"), ("admin.memory.update", [i], "ok"),
        ("admin.agent.delete", ["g"], "forbidden")]
    assert set(lines[0]) == {"ts", "agent_id", "role", "tool", "projects", "ids", "n_results",
                             "latency_ms", "outcome"}
    assert lines[0]["agent_id"] == "g" and lines[0]["n_results"] is None
    blob = json.dumps(lines)
    assert tok not in blob and hash_token(tok) not in blob and "secreto" not in blob
