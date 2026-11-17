"""Persiste as linhas de auditoria (logger punk_records.audit) em arquivo JSONL."""
import json
import logging
import os
import threading

_BLOCK = 64 * 1024


class ActivityLog:
    def __init__(self, path: str, max_bytes: int = 10_000_000):
        self.path = path
        self.max_bytes = max_bytes
        self.last_used: dict[str, float] = {}
        self._lock = threading.Lock()
        self._handler: logging.Handler | None = None
        for rec in reversed(self.tail(limit=10**9)):
            self._touch(rec)

    def _touch(self, rec: dict) -> None:
        if isinstance(rec.get("agent_id"), str) and isinstance(rec.get("ts"), (int, float)):
            self.last_used[rec["agent_id"]] = rec["ts"]

    def handler(self) -> logging.Handler:
        if self._handler is None:
            outer = self

            class _H(logging.Handler):
                def emit(self, record):
                    outer._write(record.getMessage())

            self._handler = _H(logging.INFO)
        return self._handler

    def _write(self, line: str) -> None:
        with self._lock:
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
            if os.path.getsize(self.path) > self.max_bytes:
                os.replace(self.path, self.path + ".1")
            try:
                self._touch(json.loads(line))
            except ValueError:
                pass

    def tail(self, limit: int = 100, agent: str | None = None) -> list[dict]:
        out: list[dict] = []
        try:
            f = open(self.path, "rb")
        except FileNotFoundError:
            return out
        with f:
            pos = f.seek(0, os.SEEK_END)
            buf = b""
            while pos > 0 and len(out) < limit:
                step = min(_BLOCK, pos)
                pos -= step
                f.seek(pos)
                buf = f.read(step) + buf
                lines = buf.split(b"\n")
                buf = lines[0] if pos > 0 else b""  # primeira linha pode estar cortada
                for raw in reversed(lines[1:] if pos > 0 else lines):
                    if len(out) >= limit:
                        break
                    try:
                        rec = json.loads(raw)
                    except ValueError:
                        continue
                    if isinstance(rec, dict) and (agent is None or rec.get("agent_id") == agent):
                        out.append(rec)
        return out


def install(activity: ActivityLog) -> None:
    log = logging.getLogger("punk_records.audit")
    log.setLevel(logging.INFO)
    h = activity.handler()
    if h not in log.handlers:
        log.addHandler(h)
