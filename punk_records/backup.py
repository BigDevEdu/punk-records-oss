"""Backup do storage + agents.yaml no Google Drive (OAuth do próprio usuário, escopo drive.file).

Só stdlib: o Drive REST v3 é simples o bastante para urllib. Backup e restore rodam dentro do
servidor (ADR-0005), sob o STORE_LIMITER, disparados pelo painel ou pela rotina.
"""
import contextlib
import json
import logging
import os
import shutil
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import anyio

from punk_records.config import load_config

log = logging.getLogger("punk_records.backup")

SCOPE = "https://www.googleapis.com/auth/drive.file"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
DRIVE = "https://www.googleapis.com/drive/v3"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,createdTime"
FOLDER_NAME = "Punk-Records Backups"
FOLDER_MIME = "application/vnd.google-apps.folder"
TIMEOUT = 60
PRE_RESTORE = ".pre-restore"
STAGING = ".restore-"
# fora do backup e intocados no restore: locks, a cópia de segurança e o log de auditoria
# (o registro do próprio restore não pode sumir)
_KEEP = (".punk-records.lock", ".lock", PRE_RESTORE, STAGING, "audit.jsonl")

DEFAULTS = {"client_id": "", "client_secret": "", "refresh_token": "", "folder_id": "",
            "interval_hours": 0, "keep": 7, "last_run": None, "last_error": None}


class BackupError(Exception):
    pass


def _kept(name: str) -> bool:
    return name.startswith(_KEEP)


# ---- config (backup.json, guarda segredo: 0600 e nunca sai pela API) ----

def load(path: str) -> dict:
    try:
        raw = json.loads(Path(path).read_text())
    except FileNotFoundError:
        raw = {}
    except (OSError, ValueError) as e:
        raise BackupError(f"backup.json ilegível: {e}") from e
    return {**DEFAULTS, **{k: v for k, v in raw.items() if k in DEFAULTS}}


def save(path: str, cfg: dict) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), suffix=".tmp")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(cfg, f, indent=2)
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def public(cfg: dict) -> dict:
    """O que o painel pode ver: sem client_secret nem refresh_token."""
    return {"client_id": cfg["client_id"], "has_secret": bool(cfg["client_secret"]),
            "connected": bool(cfg["refresh_token"]), "folder_id": cfg["folder_id"],
            "folder_url": (f"https://drive.google.com/drive/folders/{cfg['folder_id']}"
                           if cfg["folder_id"] else None),
            "interval_hours": cfg["interval_hours"], "keep": cfg["keep"],
            "last_run": cfg["last_run"], "last_error": cfg["last_error"]}


# ---- HTTP ----

def _open(method, url, token=None, data=None, headers=None):
    h = dict(headers or {})
    if token:
        h["Authorization"] = f"Bearer {token}"
    if isinstance(data, dict):
        data = json.dumps(data).encode()
        h["Content-Type"] = "application/json; charset=UTF-8"
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, method=method,
                                                             headers=h), timeout=TIMEOUT)
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read())
            err = body.get("error")
            msg = (err.get("message") if isinstance(err, dict) else
                   body.get("error_description") or err)
        except ValueError:
            msg = e.reason
        raise BackupError(f"Google respondeu {e.code}: {msg}") from None
    except urllib.error.URLError as e:
        raise BackupError(f"sem conexão com o Google: {e.reason}") from None


def _json(method, url, token=None, data=None, headers=None) -> dict:
    with _open(method, url, token, data, headers) as r:
        raw = r.read()
    return json.loads(raw) if raw else {}


# ---- OAuth ----

def auth_url(cfg: dict, redirect_uri: str, state: str) -> str:
    if not cfg["client_id"] or not cfg["client_secret"]:
        raise BackupError("informe e salve o Client ID e o Client Secret antes de conectar")
    return AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": cfg["client_id"], "redirect_uri": redirect_uri, "response_type": "code",
        "scope": SCOPE, "access_type": "offline", "prompt": "consent", "state": state})


def _token(form: dict) -> dict:
    return _json("POST", TOKEN_URL, data=urllib.parse.urlencode(form).encode(),
                 headers={"Content-Type": "application/x-www-form-urlencoded"})


def exchange_code(cfg: dict, code: str, redirect_uri: str) -> str:
    """Troca o code do callback pelo refresh token."""
    r = _token({"code": code, "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
                "redirect_uri": redirect_uri, "grant_type": "authorization_code"})
    if not r.get("refresh_token"):
        raise BackupError("o Google não devolveu refresh token; desconecte o app na conta Google e tente de novo")
    return r["refresh_token"]


def access_token(cfg: dict) -> str:
    if not cfg["refresh_token"]:
        raise BackupError("Google Drive não conectado")
    return _token({"refresh_token": cfg["refresh_token"], "client_id": cfg["client_id"],
                   "client_secret": cfg["client_secret"], "grant_type": "refresh_token"})["access_token"]


# ---- Drive ----

def ensure_folder(token: str, folder_id: str = "") -> str:
    """Pasta dos backups: a salva se ainda existe, senão acha pelo nome ou cria."""
    if folder_id:
        with contextlib.suppress(BackupError):  # apagada fora do app: acha ou cria outra
            f = _json("GET", f"{DRIVE}/files/{folder_id}?fields=id,trashed", token)
            if not f.get("trashed"):
                return folder_id
    q = f"name = '{FOLDER_NAME}' and mimeType = '{FOLDER_MIME}' and trashed = false"
    found = _json("GET", f"{DRIVE}/files?" + urllib.parse.urlencode({"q": q, "fields": "files(id)"}),
                  token).get("files", [])
    if found:
        return found[0]["id"]
    return _json("POST", f"{DRIVE}/files?fields=id", token,
                 {"name": FOLDER_NAME, "mimeType": FOLDER_MIME})["id"]


def upload(token: str, folder_id: str, path: Path) -> dict:
    size = path.stat().st_size
    with _open("POST", UPLOAD, token, {"name": path.name, "parents": [folder_id]},
               {"X-Upload-Content-Type": "application/gzip",
                "X-Upload-Content-Length": str(size)}) as r:
        session = r.headers["Location"]
    with open(path, "rb") as f:
        return _json("PUT", session, token, f, {"Content-Type": "application/gzip",
                                                 "Content-Length": str(size)})


def list_files(token: str, folder_id: str) -> list[dict]:
    q = f"'{folder_id}' in parents and trashed = false and name contains 'punk-records-'"
    return _json("GET", f"{DRIVE}/files?" + urllib.parse.urlencode({
        "q": q, "orderBy": "createdTime desc", "pageSize": 1000,
        "fields": "files(id,name,size,createdTime)"}), token).get("files", [])


def download(token: str, file_id: str, dest: Path) -> None:
    with _open("GET", f"{DRIVE}/files/{urllib.parse.quote(file_id)}?alt=media", token) as r, \
            open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def prune(token: str, folder_id: str, keep: int) -> int:
    old = list_files(token, folder_id)[max(keep, 1):]
    for f in old:
        _open("DELETE", f"{DRIVE}/files/{f['id']}", token).close()
    return len(old)


# ---- arquivo local ----

def snapshot(store, agents_path: str, out_dir: str) -> Path:
    """tar.gz com data/ (storage sem locks/auditoria) + agents.yaml. Segura o lock interno do
    EpochDB do flush até o fim do tar: nenhum escritor no meio."""
    storage = Path(store.settings.storage_dir)
    path = Path(out_dir) / time.strftime("punk-records-%Y%m%d-%H%M%S.tar.gz", time.gmtime())
    db = store.db
    with db._internal_lock:  # RLock: flush() pega de novo sem travar
        store.flush()
        with tarfile.open(path, "w:gz") as tar:
            for f in sorted(storage.iterdir()):
                if not _kept(f.name):
                    tar.add(f, arcname=f"data/{f.name}")
            if os.path.isfile(agents_path):
                tar.add(agents_path, arcname="agents.yaml")
    return path


def restore_from(store, agents_path: str, tar_path: Path) -> None:
    """Troca o storage pelo do backup. O atual vai para <storage>/.pre-restore (substitui o anterior);
    se o banco restaurado não abrir, o atual volta. Quem chama segura o STORE_LIMITER."""
    storage = Path(store.settings.storage_dir)
    staging = Path(tempfile.mkdtemp(prefix=STAGING, dir=storage))
    try:
        try:
            with tarfile.open(tar_path, "r:gz") as tar:
                tar.extractall(staging, filter="data")  # recusa ../, caminho absoluto e links para fora
        except (tarfile.TarError, OSError, EOFError) as e:
            raise BackupError(f"arquivo de backup inválido: {e}") from e
        data, agents = staging / "data", staging / "agents.yaml"
        if not (data / "metadata.json").is_file():
            raise BackupError("arquivo não é um backup do Punk-Records")
        if agents.is_file():
            load_config(str(agents))  # ConfigError antes de mexer em qualquer coisa

        old = storage / PRE_RESTORE
        shutil.rmtree(old, ignore_errors=True)
        old.mkdir()
        store.close_db()
        try:
            for f in storage.iterdir():
                if not _kept(f.name):
                    f.rename(old / f.name)
            for f in data.iterdir():
                f.rename(storage / f.name)
            store.open_db()
        except BaseException:
            log.exception("restore falhou, voltando o storage anterior")
            for f in storage.iterdir():
                if not _kept(f.name):
                    shutil.rmtree(f) if f.is_dir() else f.unlink()
            for f in old.iterdir():
                f.rename(storage / f.name)
            store.open_db()
            raise

        if agents.is_file():
            if os.path.isfile(agents_path):
                shutil.copy2(agents_path, old / "agents.yaml")
            tmp = Path(agents_path).with_suffix(".restore.tmp")
            shutil.copy2(agents, tmp)
            os.replace(tmp, agents_path)  # ConfigStore recarrega pelo mtime
    finally:
        shutil.rmtree(staging, ignore_errors=True)


# ---- orquestração (chamada pelo admin e pela rotina) ----

async def run_backup(settings, store, limiter) -> dict:
    """Snapshot sob o limiter (bloqueia o banco só durante o tar); upload e limpeza fora dele."""
    cfg = load(settings.backup_file)
    tmp = tempfile.mkdtemp(prefix="punk-records-backup-")
    try:
        token = await anyio.to_thread.run_sync(access_token, cfg)
        cfg["folder_id"] = await anyio.to_thread.run_sync(ensure_folder, token, cfg["folder_id"])
        path = await anyio.to_thread.run_sync(snapshot, store, settings.agents_file, tmp,
                                              limiter=limiter)
        f = await anyio.to_thread.run_sync(upload, token, cfg["folder_id"], path)
        await anyio.to_thread.run_sync(prune, token, cfg["folder_id"], int(cfg["keep"]))
        cfg.update(last_run=time.time(), last_error=None)
        return f
    except BackupError as e:
        cfg.update(last_run=time.time(), last_error=str(e))
        raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        # relê: o admin pode ter mudado intervalo/credenciais durante o upload
        cur = load(settings.backup_file)
        cur.update({k: cfg[k] for k in ("folder_id", "last_run", "last_error")})
        save(settings.backup_file, cur)


async def run_restore(settings, store, limiter, file_id: str) -> None:
    cfg = load(settings.backup_file)
    tmp = tempfile.mkdtemp(prefix="punk-records-restore-")
    try:
        token = await anyio.to_thread.run_sync(access_token, cfg)
        if file_id not in {f["id"] for f in await anyio.to_thread.run_sync(
                list_files, token, cfg["folder_id"])}:
            raise BackupError("backup não encontrado na pasta do Punk-Records")
        path = Path(tmp) / "backup.tar.gz"
        await anyio.to_thread.run_sync(download, token, file_id, path)
        await anyio.to_thread.run_sync(restore_from, store, settings.agents_file, path,
                                       limiter=limiter)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def due(cfg: dict, now: float) -> bool:
    hours = float(cfg["interval_hours"] or 0)
    return (hours > 0 and bool(cfg["refresh_token"])
            and now - float(cfg["last_run"] or 0) >= hours * 3600)


async def scheduler(settings, store, limiter, tick: float = 60) -> None:
    """Rotina: a cada `tick` s vê se o intervalo venceu. Falha fica em last_error (o painel mostra)
    e só tenta de novo no próximo intervalo."""
    while True:
        await anyio.sleep(tick)
        try:
            if due(load(settings.backup_file), time.time()):
                f = await run_backup(settings, store, limiter)
                log.info("backup automático enviado: %s", f.get("name"))
        except Exception:
            log.exception("backup automático falhou")
