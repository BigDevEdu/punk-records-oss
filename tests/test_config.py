import os

import pytest

from punk_records.config import (
    ConfigError, ConfigStore, hash_token, load_config, settings_from_env,
)

VALID = """
projects: [p1, p2]
agents:
  - {id: a1, role: agent, projects: [p1], token_sha256: "%s"}
  - {id: a2, role: global, projects: [], token_sha256: "%s"}
""" % (hash_token("pr_x"), hash_token("pr_y"))


def write(path, text, mtime=None):
    path.write_text(text)
    if mtime:
        os.utime(path, (mtime, mtime))
    return str(path)


def test_load_valid(tmp_path):
    cfg = load_config(write(tmp_path / "a.yaml", VALID))
    assert cfg.agents_by_hash[hash_token("pr_x")].id == "a1"
    assert cfg.projects == frozenset({"p1", "p2"})


@pytest.mark.parametrize("text", [
    VALID.replace("[p1], token", "[nope], token"),
    VALID.replace("id: a2", "id: a1"),
    VALID.replace("role: agent", "role: boss"),
    VALID.replace("[p1, p2]", "[p1, _shared]"),
    VALID.replace(hash_token("pr_y"), hash_token("pr_x")),
])
def test_invalid_rejected(tmp_path, text):
    with pytest.raises(ConfigError):
        load_config(write(tmp_path / "a.yaml", text))


def test_reload_on_mtime(tmp_path):
    p = tmp_path / "a.yaml"
    store = ConfigStore(write(p, VALID, 1000))
    assert store.get().agents_by_hash[hash_token("pr_x")].projects == ("p1",)
    write(p, VALID.replace("[p1], token", "[], token"), 2000)
    assert store.get().agents_by_hash[hash_token("pr_x")].projects == ()


def test_reload_keeps_previous_on_error(tmp_path):
    p = tmp_path / "a.yaml"
    store = ConfigStore(write(p, VALID, 1000))
    write(p, "projects: [: bad", 2000)
    assert hash_token("pr_x") in store.get().agents_by_hash


def test_missing_file_starts_empty_then_loads(tmp_path, caplog):
    p = tmp_path / "agents.yaml"
    store = ConfigStore(str(p))
    assert store.get().agents_by_hash == {}
    assert not [r for r in caplog.records if r.levelname == "ERROR"]
    write(p, VALID, 1000)
    assert store.get().agents_by_hash[hash_token("pr_x")].id == "a1"


def test_settings_from_env(monkeypatch):
    monkeypatch.setenv("PR_MAX_K", "10")
    assert settings_from_env().max_k == 10
