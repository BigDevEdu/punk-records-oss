"""Painel /admin: sessão por cookie (só token global ativo), API JSON e SPA estática."""
import contextlib
import functools
import json
import os
import secrets
import time
from collections import Counter
from pathlib import Path

import anyio
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route

from punk_records import agents_file, authz
from punk_records.authz import Forbidden, Invalid, NotFound
from punk_records.config import ROLES, SHARED, Agent, ConfigError, hash_token
from punk_records.graph import GraphCache, build_graph, similar_to
from punk_records.server import STORE_LIMITER, audit_log

COOKIE = "pr_session"
SESSION_TTL = 12 * 3600
LOGIN_FAIL_DELAY = 0.5  # freio simples para tentativa e erro
LOGIN_FAIL_DETAIL = "Esse token não tem papel global. Use um token de administrador."
_MUTATIONS = {"POST", "PUT", "PATCH", "DELETE"}
_STATUS = {"unauthorized": 401, "forbidden": 403, "invalid": 400, "not_found": 404}
SELF_LOCK = "Você não pode alterar o agente da sua própria sessão."
_CTX = "punk_records.admin"  # chave no scope ASGI com (sessions, config_store)


class Sessions:
    """Sessões em memória (guardam o hash do token do login): reiniciar o servidor desloga todo mundo."""

    def __init__(self, ttl: float = SESSION_TTL, now=time.time):
        self.ttl, self.now = ttl, now
        self._s: dict[str, tuple[str, float]] = {}

    def create(self, token_hash: str) -> str:
        t = self.now()
        self._s = {k: v for k, v in self._s.items() if v[1] > t}  # descarta expiradas
        sid = secrets.token_urlsafe(32)
        self._s[sid] = (token_hash, t + self.ttl)
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
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code, self.detail = code, detail


def json_error(code: str, detail: str) -> JSONResponse:
    return JSONResponse({"error": code, "detail": detail}, status_code=_STATUS[code])


def require_admin(request) -> Agent:
    """Sessão válida E o token do login ainda existe, ativo e global no ConfigStore (reconsulta a cada vez).
    Trocar o token do agente (hash muda) encerra a sessão."""
    sessions, config_store = request.scope[_CTX]
    token_hash = sessions.get(request.cookies.get(COOKIE))
    agent = config_store.get().agents_by_hash.get(token_hash) if token_hash else None
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
                return json_error(e.code, e.detail)
            except (Forbidden, Invalid, NotFound) as e:
                code = {Forbidden: "forbidden", Invalid: "invalid", NotFound: "not_found"}[type(e)]
                return json_error(code, str(e))
        return endpoint

    def audit(agent, tool, target, outcome, t0):
        audit_log.info(json.dumps({
            "ts": time.time(), "agent_id": agent.id if agent else None,
            "role": agent.role if agent else None, "tool": tool,
            "projects": list(agent.projects) if agent else [],
            "ids": [target] if isinstance(target, str) else [],
            "n_results": None, "latency_ms": round((time.monotonic() - t0) * 1000, 1),
            "outcome": outcome}))

    async def login(request):
        t0 = time.monotonic()
        token = (await read_json(request)).get("token")
        agent = (config_store.get().agents_by_hash.get(hash_token(token))
                 if isinstance(token, str) else None)
        if agent is None or agent.disabled or agent.role != "global":
            audit(None, "admin.login", None, "unauthorized", t0)
            await anyio.sleep(LOGIN_FAIL_DELAY)
            raise ApiError("unauthorized", LOGIN_FAIL_DETAIL)
        audit(agent, "admin.login", None, "ok", t0)
        sessions.drop(request.cookies.get(COOKIE))  # login novo não deixa a sessão antiga viva
        resp = JSONResponse({"agent_id": agent.id, "role": agent.role})
        resp.set_cookie(COOKIE, sessions.create(agent.token_sha256), max_age=int(sessions.ttl),
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
        if rel.startswith("assets/"):
            return json_error("not_found", f"arquivo inexistente: {request.url.path}")
        return FileResponse(index)


    cache = GraphCache()
    path = settings.agents_file

    async def run(fn, *a, **kw):
        return await anyio.to_thread.run_sync(functools.partial(fn, *a, **kw),
                                              limiter=STORE_LIMITER)

    def num(request, name, default, lo, hi, cast):
        raw = request.query_params.get(name)
        if raw is None:
            return default
        try:
            return max(lo, min(cast(raw), hi))
        except ValueError:
            raise ApiError("invalid", f"{name} inválido: {raw!r}") from None

    def csv(request, name):
        return tuple(sorted(x for x in request.query_params.get(name, "").split(",") if x))

    def as_agent(request) -> Agent | None:
        aid = request.query_params.get("as")
        if aid is None:
            return None
        a = next((x for x in config_store.get().agents_by_hash.values() if x.id == aid), None)
        if a is None:
            raise ApiError("not_found", f"agente inexistente: {aid}")
        return a

    def no_as(request):
        if "as" in request.query_params:
            raise ApiError("invalid", "editar/apagar não aceita 'as' (Ver como é só leitura)")

    @contextlib.contextmanager
    def audited(admin, tool, target):
        t0, outcome = time.monotonic(), "ok"
        try:
            yield
        except ApiError as e:
            outcome = e.code
            raise
        except Exception:
            outcome = "error"
            raise
        finally:
            audit(admin, tool, target, outcome, t0)

    # ---- dados ----
    async def graph(request, admin):
        view = as_agent(request)
        k = num(request, "k", 5, 1, 10, int)
        min_sim = num(request, "min_sim", 0.55, 0.3, 0.95, float)
        vis = (frozenset() if view.disabled else authz.visible_projects(view)) if view else None
        projects, types = csv(request, "projects"), csv(request, "types")
        recs, emb = await run(store.all_live)
        key = (len(recs), max((r["updated_at"] for r in recs), default=0), k, min_sim,
               None if vis is None else tuple(sorted(vis)), projects, types)
        out = cache.get(key)
        if out is None:
            out = await anyio.to_thread.run_sync(functools.partial(
                build_graph, recs, emb, visible=vis, projects=projects, types=types,
                k=k, min_sim=min_sim))
            cache.put(key, out)
        return JSONResponse(out)

    async def search(request, admin):
        q = request.query_params.get("q", "")
        if not q.strip():
            raise ApiError("invalid", "q vazio")
        k = num(request, "k", 10, 1, settings.max_k, int)
        view = as_agent(request)
        if view and view.disabled:  # o MCP não entrega nada a agente desativado
            return JSONResponse([])
        f = authz.build_filter(view or admin, None, None)
        rs = await run(store.query, q, k=k, filters=f)
        return JSONResponse([{"id": r["id"], "score": r["score"]} for r in rs])

    async def memory_get(request, admin):
        id = request.path_params["id"]
        view = as_agent(request)
        m = await run(store.get, id)
        if m is None:
            raise ApiError("not_found", id)
        if view:
            try:
                if view.disabled:
                    raise NotFound(id)
                authz.check_readable(view, m.get("metadata"))
            except NotFound:
                raise ApiError("not_found", id) from None  # igual a id inexistente
        recs, emb = await run(store.all_live)
        m["similar"] = await anyio.to_thread.run_sync(functools.partial(
            similar_to, recs, emb, id, visible=authz.visible_projects(view) if view else None))
        return JSONResponse(m)

    async def memory_patch(request, admin):
        no_as(request)
        id, body = request.path_params["id"], await read_json(request)
        with audited(admin, "admin.memory.update", id):
            text, meta = body.get("text"), body.get("metadata")
            if text is None and meta is None:
                raise ApiError("invalid", "informe text e/ou metadata")
            if text is not None and (not isinstance(text, str) or not text.strip()):
                raise ApiError("invalid", "text vazio")
            if meta is not None and not isinstance(meta, dict):
                raise ApiError("invalid", "metadata deve ser um objeto")
            if await run(store.get, id) is None:
                raise ApiError("not_found", id)
            await run(store.update, id, text=text, metadata=authz.strip_reserved(meta) or None)
        return JSONResponse({"id": id})

    async def memory_delete(request, admin):
        no_as(request)
        id = request.path_params["id"]
        hard = request.query_params.get("hard", "").lower() in ("1", "true")
        with audited(admin, "admin.memory.delete", id):
            if await run(store.find if hard else store.get, id) is None:
                raise ApiError("not_found", id)
            await run(store.delete, id, hard=hard)
        return JSONResponse({"id": id, "deleted": True})

    async def projects(request, admin):
        recs, _ = await run(store.all_live)
        counts = Counter(r["project"] for r in recs)
        # memória sem metadata.project (None) não vira projeto: quebrava o sorted() com 500
        names = (set(config_store.get().projects) | set(counts)) - {SHARED, None}
        order = sorted(names) + [SHARED]
        return JSONResponse([{"name": n, "count": counts[n], "color_index": i}
                             for i, n in enumerate(order)])

    async def project_delete(request, admin):
        no_as(request)
        name, body = request.path_params["name"], await read_json(request)
        with audited(admin, "admin.project.delete", name):
            dst = body.get("move_to")
            if name == SHARED:
                raise ApiError("invalid", "o projeto _shared não pode ser excluído")
            if not isinstance(dst, str) or dst == name:
                raise ApiError("invalid", "move_to deve ser outro projeto")
            recs, _ = await run(store.all_live)
            known = set(config_store.get().projects) | {r["project"] for r in recs}
            if name not in known:
                raise ApiError("not_found", f"projeto inexistente: {name}")
            if dst != SHARED and dst not in known:
                raise ApiError("invalid", f"projeto de destino inexistente: {dst}")
            # memórias primeiro: se o agents.yaml falhar depois, nada se perde e dá para repetir
            moved = await run(store.move_project, name, dst)
            changed = agents_op(agents_file.delete_project, name, dst)
        return JSONResponse({"project": name, "move_to": dst, "moved": moved, "agents": changed})

    # ---- agentes ----
    def agents_op(fn, *a, **kw):
        try:
            return fn(path, *a, **kw)
        except ConfigError as e:
            raise ApiError("invalid", str(e)) from None
        except (KeyError, FileNotFoundError):
            raise ApiError("not_found", "agente não encontrado") from None

    def guard_self(admin, id, bad=True):
        if id == admin.id and bad:
            raise ApiError("forbidden", SELF_LOCK)

    async def agents_list(request, admin):
        recs, _ = await run(store.all_live)
        counts = Counter(r["agent_id"] for r in recs)
        last = activity.last_used if activity else {}
        return JSONResponse([
            {"id": a.id, "role": a.role, "projects": list(a.projects), "disabled": a.disabled,
             "last_used_at": last.get(a.id), "memory_count": counts[a.id]}
            for a in sorted(config_store.get().agents_by_hash.values(), key=lambda a: a.id)])

    def str_list(v, name):
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            raise ApiError("invalid", f"{name} deve ser uma lista de textos")
        return v

    async def agents_create(request, admin):
        body = await read_json(request)
        id = body.get("id")
        with audited(admin, "admin.agent.create", id):
            role = body.get("role")
            if not isinstance(id, str) or role not in ROLES:
                raise ApiError("invalid", f"id (texto) e role ({', '.join(sorted(ROLES))}) obrigatórios")
            token = agents_op(agents_file.create_agent, id, role,
                              str_list(body.get("projects", []), "projects"))
        return JSONResponse({"token": token})

    async def agents_update(request, admin):
        id, body = request.path_params["id"], await read_json(request)
        with audited(admin, "admin.agent.update", id):
            role, projs, dis = body.get("role"), body.get("projects"), body.get("disabled")
            if role is not None and not isinstance(role, str):
                raise ApiError("invalid", "role deve ser texto")
            if dis is not None and not isinstance(dis, bool):
                raise ApiError("invalid", "disabled deve ser booleano")
            if projs is not None:
                str_list(projs, "projects")
            guard_self(admin, id, dis is True or (role is not None and role != "global"))
            agents_op(agents_file.update_agent, id, role=role, projects=projs, disabled=dis)
        return JSONResponse({"id": id})

    async def agents_token(request, admin):
        id = request.path_params["id"]
        with audited(admin, "admin.agent.token", id):
            guard_self(admin, id)
            token = agents_op(agents_file.rotate_token, id)
        return JSONResponse({"token": token})

    async def agents_delete(request, admin):
        id = request.path_params["id"]
        with audited(admin, "admin.agent.delete", id):
            guard_self(admin, id)
            agents_op(agents_file.delete_agent, id)
        return JSONResponse({"id": id, "deleted": True})

    async def activity_list(request, admin):
        limit = num(request, "limit", 100, 1, 500, int)
        if not activity:
            return JSONResponse([])
        return JSONResponse(await anyio.to_thread.run_sync(
            activity.tail, limit, request.query_params.get("agent")))

    def by_method(**handlers):
        async def h(request, admin):
            h = handlers.get(request.method) or (handlers.get("GET") if request.method == "HEAD" else None)
            if h is None:
                raise ApiError("not_found", f"rota inexistente: {request.url.path}")
            return await h(request, admin)
        return api(h)

    api_routes = [
        Route("/admin/api/login", api(login, auth=False), methods=["POST"]),
        Route("/admin/api/logout", api(logout, auth=False), methods=["POST"]),
        Route("/admin/api/me", api(me), methods=["GET"]),
        Route("/admin/api/graph", api(graph), methods=["GET"]),
        Route("/admin/api/search", api(search), methods=["GET"]),
        Route("/admin/api/memories/{id}", by_method(GET=memory_get, PATCH=memory_patch,
              DELETE=memory_delete), methods=["GET", "PATCH", "DELETE"]),
        Route("/admin/api/projects", api(projects), methods=["GET"]),
        Route("/admin/api/projects/{name}", by_method(DELETE=project_delete), methods=["DELETE"]),
        Route("/admin/api/agents", by_method(GET=agents_list, POST=agents_create),
              methods=["GET", "POST"]),
        Route("/admin/api/agents/{id}", by_method(PATCH=agents_update, DELETE=agents_delete),
              methods=["PATCH", "DELETE"]),
        Route("/admin/api/agents/{id}/token", api(agents_token), methods=["POST"]),
        Route("/admin/api/activity", api(activity_list), methods=["GET"]),
    ]
    return api_routes + [
        Route("/admin/api", api_not_found),
        Route("/admin/api/{rest:path}", api_not_found),
        Route("/admin", spa, methods=["GET"]),
        Route("/admin/{path:path}", spa, methods=["GET"]),
    ]
