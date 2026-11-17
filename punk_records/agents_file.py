import os
import re
import secrets
import tempfile
import threading
from pathlib import Path

import yaml

from punk_records.config import SHARED, ConfigError, hash_token, load_config

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
_lock = threading.Lock()


def new_token() -> str:
    return "pr_" + secrets.token_urlsafe(32)


def load_raw(path: str, create: bool = False) -> dict:
    if create and not os.path.exists(path):
        return {"projects": [], "agents": []}
    raw = yaml.safe_load(Path(path).read_text()) or {}
    if not isinstance(raw, dict):
        raise ConfigError("agents.yaml deve ser um mapeamento")
    raw["projects"] = raw.get("projects") or []
    raw["agents"] = raw.get("agents") or []
    if not all(isinstance(a, dict) for a in raw["agents"]):
        raise ConfigError("cada entrada em agents deve ser um mapeamento")
    return raw


def save(path: str, raw: dict) -> None:
    # Valida o conteudo novo num temp no mesmo diretorio antes de substituir o original.
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        yaml.safe_dump(raw, f, sort_keys=False, allow_unicode=True)
    try:
        load_config(tmp)
    except ConfigError:
        os.unlink(tmp)
        raise
    os.replace(tmp, path)


def _find(raw: dict, agent_id: str) -> dict:
    for a in raw["agents"]:
        if a.get("id") == agent_id:
            return a
    raise KeyError(agent_id)


def _add_projects(raw: dict, projects: list[str]) -> list[str]:
    for p in projects:
        if not p or p == SHARED:
            raise ConfigError(f"projeto invalido: {p!r}")
    raw["projects"] += [p for p in projects if p not in raw["projects"]]
    return projects


def create_agent(path: str, agent_id: str, role: str, projects: list[str]) -> str:
    with _lock:
        if not ID_RE.match(agent_id):
            raise ConfigError(f"id invalido: {agent_id!r}")
        raw = load_raw(path, create=True)
        if any(a.get("id") == agent_id for a in raw["agents"]):
            raise ConfigError(f"id ja existe: {agent_id}")
        _add_projects(raw, projects)
        token = new_token()
        raw["agents"].append({"id": agent_id, "role": role, "projects": list(projects),
                              "token_sha256": hash_token(token)})
        save(path, raw)
        return token


def update_agent(path: str, agent_id: str, *, role: str | None = None,
                 projects: list[str] | None = None, disabled: bool | None = None) -> None:
    with _lock:
        raw = load_raw(path)
        agent = _find(raw, agent_id)
        if role is not None:
            agent["role"] = role
        if projects is not None:
            _add_projects(raw, projects)
            agent["projects"] = list(projects)
        if disabled is not None:
            agent["disabled"] = disabled
        save(path, raw)


def rotate_token(path: str, agent_id: str) -> str:
    with _lock:
        raw = load_raw(path)
        agent = _find(raw, agent_id)
        token = new_token()
        agent["token_sha256"] = hash_token(token)
        save(path, raw)
        return token


def delete_agent(path: str, agent_id: str) -> None:
    with _lock:
        raw = load_raw(path)
        _find(raw, agent_id)
        raw["agents"] = [a for a in raw["agents"] if a.get("id") != agent_id]
        save(path, raw)
