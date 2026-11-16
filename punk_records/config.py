import hashlib
import logging
import os
from dataclasses import dataclass
from pathlib import Path

import yaml

ROLES = {"agent", "project_admin", "global"}
SHARED = "_shared"


class ConfigError(Exception):
    pass


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass(frozen=True)
class Agent:
    id: str
    role: str
    projects: tuple[str, ...]
    token_sha256: str
    disabled: bool = False


@dataclass(frozen=True)
class Config:
    projects: frozenset[str]
    agents_by_hash: dict[str, Agent]


def load_config(path: str) -> Config:
    try:
        raw = yaml.safe_load(Path(path).read_text())
        projects = frozenset(raw.get("projects") or [])
        if SHARED in projects:
            raise ConfigError(f"{SHARED} e implicito, nao pode estar em projects")
        agents, ids = {}, set()
        for a in raw.get("agents") or []:
            agent = Agent(
                id=a["id"], role=a["role"], projects=tuple(a.get("projects") or ()),
                token_sha256=a["token_sha256"], disabled=bool(a.get("disabled", False)),
            )
            if agent.id in ids:
                raise ConfigError(f"id duplicado: {agent.id}")
            ids.add(agent.id)
            if agent.role not in ROLES:
                raise ConfigError(f"papel invalido: {agent.role}")
            if not set(agent.projects) <= projects:
                raise ConfigError(f"projeto desconhecido em {agent.id}")
            if agent.token_sha256 in agents:
                raise ConfigError(
                    f"token duplicado entre {agents[agent.token_sha256].id} e {agent.id}")
            agents[agent.token_sha256] = agent
    except ConfigError:
        raise
    except (OSError, yaml.YAMLError, AttributeError, KeyError, TypeError) as e:
        raise ConfigError(f"agents.yaml invalido: {e!r}") from e
    return Config(projects, agents)


class ConfigStore:
    def __init__(self, path: str):
        self.path = path
        self._config = load_config(path)
        self._mtime = os.stat(path).st_mtime_ns

    def get(self) -> Config:
        try:
            mtime = os.stat(self.path).st_mtime_ns
            if mtime != self._mtime:
                self._config = load_config(self.path)
                self._mtime = mtime
        except (ConfigError, OSError) as e:
            logging.error("falha ao recarregar %s, mantendo config anterior: %s", self.path, e)
        return self._config


@dataclass(frozen=True)
class Settings:
    storage_dir: str = "/data"
    agents_file: str = "/config/agents.yaml"
    embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2"
    embedding_dim: int = 384
    host: str = "0.0.0.0"
    port: int = 8000
    max_k: int = 50


def settings_from_env() -> Settings:
    e, d = os.environ, Settings()
    return Settings(
        storage_dir=e.get("PR_STORAGE_DIR", d.storage_dir),
        agents_file=e.get("PR_AGENTS_FILE", d.agents_file),
        embedding_model=e.get("PR_EMBEDDING_MODEL", d.embedding_model),
        embedding_dim=int(e.get("PR_EMBEDDING_DIM", d.embedding_dim)),
        host=e.get("PR_HOST", d.host),
        port=int(e.get("PR_PORT", d.port)),
        max_k=int(e.get("PR_MAX_K", d.max_k)),
    )
