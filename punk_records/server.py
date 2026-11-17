"""Servidor MCP (TRD §6/§7): tools sobre o MemoryStore, atrás de bearer token."""
import contextvars
import functools
import json
import logging
import time

import anyio
from mcp.server.mcpserver import MCPServer
from starlette.responses import JSONResponse

from punk_records import authz
from punk_records.authz import Forbidden, Invalid, NotFound
from punk_records.config import SHARED, Agent, hash_token

current_agent: contextvars.ContextVar[Agent] = contextvars.ContextVar("current_agent")

# ponytail: global lock, finer locks if throughput matters
STORE_LIMITER = anyio.CapacityLimiter(1)

audit_log = logging.getLogger("punk_records.audit")

_ERRORS = {Forbidden: "forbidden", Invalid: "invalid", NotFound: "not_found"}


class BearerAuth:
    """ASGI puro: /healthz livre; demais rotas HTTP exigem Bearer válido e não desabilitado."""

    def __init__(self, app, config_store):
        self.app, self.config_store = app, config_store

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] == "/healthz":
            return await self.app(scope, receive, send)
        auth = dict(scope["headers"]).get(b"authorization", b"").decode("latin-1")
        agent = None
        if auth[:7].lower() == "bearer ":
            agent = self.config_store.get().agents_by_hash.get(hash_token(auth[7:].strip()))
        if agent is None or agent.disabled:
            return await JSONResponse({"error": "unauthorized"}, status_code=401)(
                scope, receive, send)
        token = current_agent.set(agent)
        try:
            await self.app(scope, receive, send)
        finally:
            current_agent.reset(token)


def _text(v, name):
    if not isinstance(v, str) or not v.strip():
        raise Invalid(f"{name} vazio")
    return v


MEMORY_TYPES = ("general", "episodic", "profile", "working", "skill")


def _memory_type(v):
    if v is not None and v not in MEMORY_TYPES:
        raise Invalid(f"memory_type inválido: {v}; use um de {', '.join(MEMORY_TYPES)}")
    return v


def _ids(result):
    items = result if isinstance(result, list) else [result]
    return [i["id"] for i in items if isinstance(i, dict) and isinstance(i.get("id"), str)]


def create_server(settings, config_store, store) -> MCPServer:
    mcp = MCPServer("punk-records")

    def clamp_k(k):
        return max(1, min(int(k), settings.max_k))

    async def run(fn, *a, **kw):
        return await anyio.to_thread.run_sync(
            functools.partial(fn, *a, **kw), limiter=STORE_LIMITER)

    def visible(agent, tool, results):
        out, n = authz.postfilter(agent, results)
        if n:
            logging.critical("isolation_violation agent=%s tool=%s n=%d", agent.id, tool, n)
        return out

    def tool(fn):
        """Registra a tool: erros viram dict, e cada chamada gera uma linha de auditoria."""
        name = fn.__name__

        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            agent, t0, outcome, result = current_agent.get(), time.monotonic(), "ok", None
            try:
                result = await fn(*args, **kwargs)
            except (Forbidden, Invalid, NotFound) as e:
                outcome = _ERRORS[type(e)]
                result = {"error": outcome, "detail": str(e)}
            except TypeError as e:  # filtro do cliente com tipos incompatíveis no store
                outcome = "invalid"
                result = {"error": outcome, "detail": f"filtro inválido: {e}"}
            except Exception:
                outcome = "error"
                raise
            finally:
                audit_log.info(json.dumps({
                    "ts": time.time(), "agent_id": agent.id, "role": agent.role, "tool": name,
                    "projects": list(agent.projects), "ids": _ids(result) if result else [],
                    "n_results": len(result) if isinstance(result, list) else None,
                    "latency_ms": round((time.monotonic() - t0) * 1000, 1), "outcome": outcome,
                }))
            return result

        mcp.add_tool(wrapper)
        return wrapper

    @tool
    async def memory_whoami() -> dict:
        """Mostra quem você é: agent_id, papel e projetos acessíveis (mais o `_shared`)."""
        a = current_agent.get()
        return {"agent_id": a.id, "role": a.role, "projects": list(a.projects), "shared": SHARED}

    @tool
    async def memory_remember(text: str, project: str | None = None,
                              metadata: dict | None = None,
                              memory_type: str | None = None) -> dict:
        """Grave decisões, convenções, erros resolvidos e preferências. Use project="_shared"
        para o que vale em qualquer projeto; sem project, usa o seu único projeto."""
        a = current_agent.get()
        _text(text, "text")
        _memory_type(memory_type)
        proj = authz.resolve_write_project(a, project, config_store.get().projects)
        meta = authz.sanitize_metadata(a, proj, metadata) | {"created_at": time.time()}
        id_ = await run(store.remember, text, meta, memory_type)
        return {"id": id_, "project": proj}

    @tool
    async def memory_query(query: str, project: str | None = None, k: int = 5,
                           min_score: float = 0.0, memory_type: str | None = None,
                           filters: dict | None = None,
                           context_window: int = 0) -> dict | list:
        """Busca semântica na memória. Consulte antes de decidir ou propor algo; sem project,
        busca em todos os projetos visíveis a você (incluindo `_shared`)."""
        a = current_agent.get()
        _text(query, "query")
        _memory_type(memory_type)
        f = authz.build_filter(a, project, filters)
        rs = await run(store.query, query, k=clamp_k(k), filters=f, min_score=min_score,
                       memory_type=memory_type, context_window=max(0, int(context_window)))
        return visible(a, "memory_query", rs)

    @tool
    async def memory_multi_hop(query: str, project: str | None = None, hops: int = 2,
                               k: int = 5) -> dict | list:
        """Busca com múltiplos saltos (segue entidades relacionadas); mesmas regras de
        visibilidade de memory_query."""
        a = current_agent.get()
        _text(query, "query")
        f = authz.build_filter(a, project, None)
        rs = await run(store.multi_hop, query, hops=max(1, min(int(hops), 5)),
                       k=clamp_k(k), filters=f)
        return visible(a, "memory_multi_hop", rs)

    @tool
    async def memory_adaptive_query(query: str, k: int = 5) -> dict | list:
        """Busca adaptativa (somente papel global; não filtra por projeto)."""
        a = current_agent.get()
        authz.require_global(a)
        _text(query, "query")
        return visible(a, "memory_adaptive_query",
                       await run(store.adaptive_query, query, k=clamp_k(k)))

    async def _owned(a, id):
        """get -> check_readable -> can_modify; 'não encontrado' não revela projetos alheios."""
        cur = await run(store.get, id)
        if cur is None:
            raise NotFound(id)
        meta = cur.get("metadata") or {}
        try:
            authz.check_readable(a, meta)
        except NotFound:
            raise NotFound(id) from None  # idêntico ao id inexistente: sem oráculo de existência
        if not authz.can_modify(a, meta):
            raise Forbidden("sem permissão para modificar")

    @tool
    async def memory_update(id: str, text: str | None = None,
                            metadata: dict | None = None) -> dict:
        """Atualiza texto e/ou metadata de uma memória que você pode modificar.
        project e agent_id são imutáveis."""
        a = current_agent.get()
        await _owned(a, id)
        if text is not None:
            _text(text, "text")
        patch = authz.strip_reserved(metadata)
        await run(store.update, id, text=text, metadata=patch or None)
        return {"id": id}

    @tool
    async def memory_delete(id: str, hard: bool = False) -> dict:
        """Remove (soft) uma memória que você pode modificar. hard=true exige papel global."""
        a = current_agent.get()
        if hard:
            authz.require_global(a)
        await _owned(a, id)
        await run(store.delete, id, hard=hard)
        return {"id": id, "deleted": True}

    @tool
    async def memory_entity_graph(entity: str, depth: int = 2) -> dict:
        """Grafo de entidades (somente papel global)."""
        authz.require_global(current_agent.get())
        _text(entity, "entity")
        return await run(store.entity_graph, entity, depth=max(1, min(int(depth), 5)))

    @tool
    async def memory_timeline(entity: str | None = None, start: float | None = None,
                              end: float | None = None) -> dict | list:
        """Memórias em ordem cronológica de gravação/edição (somente papel global).
        Sem entity: todas; start/end são timestamps Unix. Com entity: só funciona se o
        EpochDB tiver extraído entidades (extração automática está desligada)."""
        a = current_agent.get()
        authz.require_global(a)
        return visible(a, "memory_timeline", await run(store.timeline, entity, start, end))

    @tool
    async def memory_sql(sql: str) -> dict | list:
        """SQL (DuckDB) sobre a view `cold_tier`: só memórias já arquivadas em disco pelo
        EpochDB; antes do primeiro arquivamento qualquer consulta volta vazia (somente global)."""
        authz.require_global(current_agent.get())
        _text(sql, "sql")
        try:
            return await run(store.sql, sql)
        except Exception as e:  # erro do DuckDB/consulta: devolve a mensagem ao chamador
            raise Invalid(f"SQL falhou: {e}") from e

    @tool
    async def memory_compact() -> dict:
        """Compacta o armazenamento (somente papel global)."""
        authz.require_global(current_agent.get())
        await run(store.compact)
        return {"compacted": True}

    @mcp.custom_route("/healthz", methods=["GET"])
    async def healthz(request):
        return JSONResponse({"ok": True})

    return mcp


def build_app(settings, config_store, store):
    mcp = create_server(settings, config_store, store)
    return BearerAuth(mcp.streamable_http_app(stateless_http=True, host=settings.host), config_store)
