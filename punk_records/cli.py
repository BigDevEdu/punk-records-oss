import argparse
import os
import secrets
import sys
import tempfile
from pathlib import Path

import yaml

from punk_records.config import ConfigError, hash_token, load_config, settings_from_env


def _load_raw(path: str, create: bool = False) -> dict:
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


def _save(path: str, raw: dict) -> int:
    # Valida o conteudo novo num temp no mesmo diretorio antes de substituir o original.
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        yaml.safe_dump(raw, f, sort_keys=False, allow_unicode=True)
    try:
        load_config(tmp)
    except ConfigError as e:
        os.unlink(tmp)
        print(f"erro: {e}", file=sys.stderr)
        return 1
    os.replace(tmp, path)
    return 0


def _new(args, path: str) -> int:
    token = "pr_" + secrets.token_urlsafe(32)
    projects = [p.strip() for p in args.projects.split(",") if p.strip()]
    raw = _load_raw(path, create=True)
    raw["projects"] += [p for p in projects if p not in raw["projects"]]
    entry = {"id": args.agent_id, "role": args.role, "projects": projects,
             "token_sha256": hash_token(token)}
    raw["agents"] = [a for a in raw["agents"] if a.get("id") != args.agent_id] + [entry]
    if _save(path, raw) != 0:
        return 1
    print(token)
    return 0


def _list(path: str) -> int:
    for a in load_config(path).agents_by_hash.values():
        print(f"{a.id} {a.role} {','.join(a.projects) or '-'} {str(a.disabled).lower()}")
    return 0


def _revoke(args, path: str) -> int:
    raw = _load_raw(path)
    for a in raw["agents"]:
        if a.get("id") == args.agent_id:
            a["disabled"] = True
            return _save(path, raw)
    print(f"erro: agente nao encontrado: {args.agent_id}", file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="punk-records")
    cmds = parser.add_subparsers(dest="cmd", required=True)
    token = cmds.add_parser("token").add_subparsers(dest="action", required=True)

    new = token.add_parser("new")
    new.add_argument("agent_id")
    new.add_argument("--role", required=True)
    new.add_argument("--projects", default="")
    new.add_argument("--file")

    lst = token.add_parser("list")
    lst.add_argument("--file")

    rev = token.add_parser("revoke")
    rev.add_argument("agent_id")
    rev.add_argument("--file")

    args = parser.parse_args(argv)
    path = args.file or settings_from_env().agents_file
    try:
        if args.action == "new":
            return _new(args, path)
        if args.action == "list":
            return _list(path)
        return _revoke(args, path)
    except (ConfigError, OSError, yaml.YAMLError) as e:
        print(f"erro: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
