"""Painel /admin: sessão por cookie (só token global ativo), API JSON e SPA estática."""
import os
import secrets
import time
from pathlib import Path

import anyio
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route

from punk_records.authz import Forbidden, Invalid, NotFound
from punk_records.config import Agent, hash_token

COOKIE = "pr_session"
SESSION_TTL = 12 * 3600
LOGIN_FAIL_DELAY = 0.5  # freio simples para tentativa e erro
LOGIN_FAIL_DETAIL = "Esse token não tem papel global. Use um token de administrador."
_MUTATIONS = {"POST", "PUT", "PATCH", "DELETE"}
_STATUS = {"unauthorized": 401, "forbidden": 403, "invalid": 400, "not_found": 404}
_CTX = "punk_records.admin"  # chave no scope ASGI com (sessions, config_store)


class Sessions:
    """Sessões em memória: reiniciar o servidor desloga todo mundo (um operador)."""

    def __init__(self, ttl: float = SESSION_TTL, now=time.time):
        self.ttl, self.now = ttl, now
        self._s: dict[str, tuple[str, float]] = {}

    def create(self, agent_id: str) -> str:
        t = self.now()
        self._s = {k: v for k, v in self._s.items() if v[1] > t}  # descarta expiradas
        sid = secrets.token_urlsafe(32)
        self._s[sid] = (agent_id, t + self.ttl)
        return sid

    def get(self, sid: str | None) -> str | None:
        hit = self._s.get(sid) if sid else None
        if hit is None:
            return None
        if hit[1] <= self.now():
            self._s.pop(sid, None)
            return None
        return hit[0]

    def drop(self, sid: str | None) -> None:
        if sid:
            self._s.pop(sid, None)


class ApiError(Exception):
    def __init__(self, code: str, detail: str, status: int | None = None):
        super().__init__(detail)
        self.code, self.detail, self.status = code, detail, status or _STATUS[code]


def json_error(code: str, detail: str, status: int | None = None) -> JSONResponse:
    return JSONResponse({"error": code, "detail": detail}, status_code=status or _STATUS[code])


def require_admin(request) -> Agent:
    """Sessão válida E agente ainda existe, ativo e global no ConfigStore (reconsulta a cada vez)."""
    sessions, config_store = request.scope[_CTX]
    agent_id = sessions.get(request.cookies.get(COOKIE))
    agent = None
    if agent_id is not None:
        agent = next((a for a in config_store.get().agents_by_hash.values()
                      if a.id == agent_id), None)
    if agent is None or agent.disabled or agent.role != "global":
        raise ApiError("unauthorized", "sessão inválida ou expirada; faça login de novo")
    return agent


async def read_json(request) -> dict:
    try:
        body = await request.json()
    except ValueError:
        raise ApiError("invalid", "corpo não é JSON válido") from None
    if not isinstance(body, dict):
        raise ApiError("invalid", "corpo deve ser um objeto JSON")
    return body


def routes(settings, config_store, store, activity, web_dir) -> list[Route]:
    sessions = Sessions()
    secure = os.environ.get("PR_ADMIN_INSECURE_COOKIE") != "1"
    root = Path(web_dir).resolve()

    def api(handler, auth=True):
        """Envolve handler(request, agent) — ou handler(request) se auth=False — com sessão,
        exigência de JSON nas mutações e erros no formato {"error", "detail"}."""
        async def endpoint(request):
            request.scope[_CTX] = (sessions, config_store)
            try:
                agent = require_admin(request) if auth else None
                ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
                if request.method in _MUTATIONS and ctype != "application/json":
                    raise ApiError("invalid", "Content-Type deve ser application/json")
                return await (handler(request, agent) if auth else handler(request))
            except ApiError as e:
                return json_error(e.code, e.detail, e.status)
            except (Forbidden, Invalid, NotFound) as e:
                code = {Forbidden: "forbidden", Invalid: "invalid", NotFound: "not_found"}[type(e)]
                return json_error(code, str(e))
        return endpoint

    async def login(request):
        token = (await read_json(request)).get("token")
        agent = (config_store.get().agents_by_hash.get(hash_token(token))
                 if isinstance(token, str) else None)
        if agent is None or agent.disabled or agent.role != "global":
            await anyio.sleep(LOGIN_FAIL_DELAY)
            raise ApiError("unauthorized", LOGIN_FAIL_DETAIL)
        resp = JSONResponse({"agent_id": agent.id, "role": agent.role})
        resp.set_cookie(COOKIE, sessions.create(agent.id), max_age=int(sessions.ttl),
                        path="/admin", secure=secure, httponly=True, samesite="strict")
        return resp

    async def logout(request):
        sessions.drop(request.cookies.get(COOKIE))
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(COOKIE, path="/admin", secure=secure, httponly=True,
                           samesite="strict")
        return resp

    async def me(request, agent):
        return JSONResponse({"agent_id": agent.id, "role": agent.role})

    async def api_not_found(request):
        return json_error("not_found", f"rota inexistente: {request.url.path}")

    async def spa(request):
        """Arquivo existente dentro de web_dir; senão index.html (fallback da SPA)."""
        index = root / "index.html"
        if not index.is_file():
            return json_error("not_found", "painel não foi buildado")
        rel = request.path_params.get("path", "")
        f = (root / rel).resolve()
        if rel and f.is_relative_to(root) and f.is_file():
            return FileResponse(f)
        return FileResponse(index)

    # Task 5: novas rotas da API entram aqui, antes do catch-all de /admin/api.
    api_routes = [
        Route("/admin/api/login", api(login, auth=False), methods=["POST"]),
        Route("/admin/api/logout", api(logout, auth=False), methods=["POST"]),
        Route("/admin/api/me", api(me), methods=["GET"]),
    ]
    return api_routes + [
        Route("/admin/api/{rest:path}", api_not_found),
        Route("/admin", spa, methods=["GET"]),
        Route("/admin/{path:path}", spa, methods=["GET"]),
    ]
