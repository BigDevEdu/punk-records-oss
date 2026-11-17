import dataclasses

import pytest
from starlette.testclient import TestClient

from punk_records import admin
from punk_records.config import Config
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
    for path in ("/admin", "/admin/", "/admin/agentes", "/admin/assets/nada.js"):
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
