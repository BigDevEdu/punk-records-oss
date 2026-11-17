import json
import logging
import os

from punk_records.activity import ActivityLog, install


def _emit(act, **kw):
    rec = logging.LogRecord("punk_records.audit", logging.INFO, "", 0, json.dumps(kw), None, None)
    act.handler().handle(rec)


def test_handler_appends_and_updates_last_used(tmp_path):
    p = tmp_path / "a.jsonl"
    act = ActivityLog(str(p))
    _emit(act, ts=5.0, agent_id="x", tool="t")
    assert json.loads(p.read_text().strip())["agent_id"] == "x"
    assert act.last_used == {"x": 5.0}


def test_rotation_at_max_bytes(tmp_path):
    p = tmp_path / "a.jsonl"
    act = ActivityLog(str(p), max_bytes=200)
    for i in range(10):
        _emit(act, ts=float(i), agent_id="x", tool="t")
    assert os.path.exists(str(p) + ".1")
    assert not p.exists() or p.stat().st_size < 200 + 60


def test_last_used_rebuilt_on_init(tmp_path):
    p = tmp_path / "a.jsonl"
    act = ActivityLog(str(p))
    _emit(act, ts=1.0, agent_id="x")
    _emit(act, ts=2.0, agent_id="y")
    _emit(act, ts=3.0, agent_id="x")
    assert ActivityLog(str(p)).last_used == {"x": 3.0, "y": 2.0}


def test_tail_newest_first_and_agent_filter(tmp_path):
    act = ActivityLog(str(tmp_path / "a.jsonl"))
    for i in range(5):
        _emit(act, ts=float(i), agent_id="x" if i % 2 else "y")
    assert [r["ts"] for r in act.tail(limit=3)] == [4.0, 3.0, 2.0]
    assert [r["ts"] for r in act.tail(agent="x")] == [3.0, 1.0]


def test_tail_skips_bad_lines(tmp_path):
    p = tmp_path / "a.jsonl"
    act = ActivityLog(str(p))
    _emit(act, ts=1.0, agent_id="x")
    with open(p, "a") as f:
        f.write("lixo\n")
    _emit(act, ts=2.0, agent_id="x")
    assert [r["ts"] for r in act.tail()] == [2.0, 1.0]


def test_install_idempotent(tmp_path):
    act = ActivityLog(str(tmp_path / "a.jsonl"))
    log = logging.getLogger("punk_records.audit")
    n = len(log.handlers)
    install(act)
    install(act)
    try:
        assert len(log.handlers) == n + 1
        log.info(json.dumps({"ts": 1.0, "agent_id": "x"}))
        assert len(act.tail()) == 1
    finally:
        for h in log.handlers[n:]:
            log.removeHandler(h)
