"""Autorização (TRD §6, ADR-0003). Funções puras, sem I/O; fail closed."""
from punk_records.config import SHARED, Agent

__all__ = [
    "SHARED", "RESERVED", "ALLOWED_OPS", "Forbidden", "Invalid", "NotFound",
    "visible_projects", "resolve_write_project", "validate_client_filters", "build_filter",
    "can_modify", "sanitize_metadata", "postfilter", "require_global", "check_readable",
]

RESERVED = frozenset({"agent_id", "project", "created_by_role"})
ALLOWED_OPS = frozenset({"$eq", "$ne", "$in", "$nin", "$gt", "$gte", "$lt", "$lte"})


class Forbidden(Exception):
    pass


class Invalid(Exception):
    pass


class NotFound(Exception):
    pass


def visible_projects(a: Agent) -> frozenset[str] | None:
    """None = sem restrição (global)."""
    return None if a.role == "global" else frozenset(a.projects) | {SHARED}


def _visible(a: Agent, project) -> bool:
    vis = visible_projects(a)
    return vis is None or project in vis


def resolve_write_project(a: Agent, project: str | None, known: frozenset[str]) -> str:
    if project is None:
        if a.role != "global" and len(a.projects) == 1:
            project = a.projects[0]
        else:
            raise Invalid("project obrigatório")
    if not _visible(a, project):
        raise Forbidden(project)
    if project != SHARED and project not in known:
        raise Invalid(f"projeto desconhecido: {project}")
    return project


def validate_client_filters(f: dict | None) -> dict:
    if f is None:
        return {}
    if not isinstance(f, dict):
        raise Invalid("filters deve ser um objeto")
    for k, v in f.items():
        if not isinstance(k, str) or k in RESERVED or k.startswith(("_", "$")):
            raise Invalid(f"chave de filtro não permitida: {k!r}")
        if isinstance(v, dict):
            # EpochDB trata operador desconhecido (ou dict sem operador) como igualdade.
            if not v or not set(v) <= ALLOWED_OPS:
                raise Invalid(f"operador não permitido em {k!r}")
    return dict(f)


def build_filter(a: Agent, project: str | None, client_filters: dict | None) -> dict:
    f = validate_client_filters(client_filters)
    vis = visible_projects(a)
    if project is not None:
        if vis is not None and project not in vis:
            raise Forbidden(project)
        f["project"] = project
    elif vis is not None:
        f["project"] = {"$in": sorted(vis)}
    return f


def can_modify(a: Agent, meta: dict) -> bool:
    if a.role == "global":
        return True
    project = meta.get("project")
    if not _visible(a, project):
        return False
    if a.role == "project_admin" and project in a.projects:
        return True
    return meta.get("agent_id") == a.id


def sanitize_metadata(a: Agent, project: str, meta: dict | None) -> dict:
    clean = {k: v for k, v in (meta or {}).items()
             if k not in RESERVED and not k.startswith("_")}
    return clean | {"agent_id": a.id, "project": project, "created_by_role": a.role}


def postfilter(a: Agent, results: list[dict]) -> tuple[list[dict], int]:
    """Remove resultados/vizinhos não visíveis. Só resultado removido conta como violação."""
    if visible_projects(a) is None:
        return list(results), 0
    out, violations = [], 0
    for r in results:
        meta = r.get("metadata") or {}
        if not (_visible(a, r.get("project")) and _visible(a, meta.get("project"))):
            violations += 1
            continue
        if "context_neighbors" in meta:
            neighbors = [n for n in meta["context_neighbors"] or []
                         if _visible(a, (n.get("metadata") or {}).get("project"))]
            r = r | {"metadata": meta | {"context_neighbors": neighbors}}
        out.append(r)
    return out, violations


def require_global(a: Agent) -> None:
    if a.role != "global":
        raise Forbidden("requer papel global")


def check_readable(a: Agent, meta: dict | None) -> None:
    if not _visible(a, (meta or {}).get("project")):
        raise NotFound()
