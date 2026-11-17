import argparse
import os
import sys

import yaml

from punk_records import agents_file
from punk_records.config import ConfigError, hash_token, load_config, settings_from_env


def _new(args, path: str) -> int:
    # Substitui o agente se o id ja existe (diferente de agents_file.create_agent, que recusa).
    token = agents_file.new_token()
    projects = [p.strip() for p in args.projects.split(",") if p.strip()]
    raw = agents_file.load_raw(path, create=True)
    raw["projects"] += [p for p in projects if p not in raw["projects"]]
    entry = {"id": args.agent_id, "role": args.role, "projects": projects,
             "token_sha256": hash_token(token)}
    raw["agents"] = [a for a in raw["agents"] if a.get("id") != args.agent_id] + [entry]
    agents_file.save(path, raw)  # ConfigError vai para o main, que imprime "erro:"
    print(token)
    return 0


def _list(path: str) -> int:
    for a in load_config(path).agents_by_hash.values():
        print(f"{a.id} {a.role} {','.join(a.projects) or '-'} {str(a.disabled).lower()}")
    return 0


def _revoke(args, path: str) -> int:
    try:
        agents_file.update_agent(path, args.agent_id, disabled=True)
    except KeyError:
        print(f"erro: agente nao encontrado: {args.agent_id}", file=sys.stderr)
        return 1
    return 0


def _serve() -> int:
    import uvicorn

    from punk_records.activity import ActivityLog, install
    from punk_records.config import ConfigStore
    from punk_records.server import build_app
    from punk_records.store import MemoryStore, StorageLocked

    settings = settings_from_env()
    try:
        config_store = ConfigStore(settings.agents_file)
        store = MemoryStore(settings)
        activity = ActivityLog(os.path.join(settings.storage_dir, "audit.jsonl"))
    except (ConfigError, OSError, StorageLocked) as e:
        print(f"erro: {e}", file=sys.stderr)
        return 1
    install(activity)
    try:
        uvicorn.run(build_app(settings, config_store, store, activity),
                    host=settings.host, port=settings.port, workers=1)
    finally:
        store.close()
    return 0


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

    cmds.add_parser("serve")

    args = parser.parse_args(argv)
    if args.cmd == "serve":
        return _serve()
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
