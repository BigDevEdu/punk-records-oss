import pytest

from punk_records import agents_file
from punk_records.config import ConfigError, hash_token, load_config


def test_create_agent_creates_file(tmp_path):
    path = str(tmp_path / "agents.yaml")
    token = agents_file.create_agent(path, "bot", "agent", ["a"])
    cfg = load_config(path)
    assert cfg.agents_by_hash[hash_token(token)].id == "bot"
    assert cfg.projects == {"a"}


def test_create_duplicate_id_raises(tmp_path):
    path = str(tmp_path / "agents.yaml")
    agents_file.create_agent(path, "bot", "agent", ["a"])
    with pytest.raises(ConfigError):
        agents_file.create_agent(path, "bot", "agent", ["a"])


def test_invalid_id_raises(tmp_path):
    path = tmp_path / "agents.yaml"
    with pytest.raises(ConfigError):
        agents_file.create_agent(str(path), "Bad_Id", "agent", [])
    with pytest.raises(ConfigError):
        agents_file.create_agent(str(path), "bot", "agent", ["_shared"])
    assert not path.exists()


def test_update_role_projects_disabled(tmp_path):
    path = str(tmp_path / "agents.yaml")
    token = agents_file.create_agent(path, "bot", "agent", ["a"])
    agents_file.update_agent(path, "bot", role="project_admin", projects=["b"], disabled=True)
    cfg = load_config(path)
    agent = cfg.agents_by_hash[hash_token(token)]
    assert agent.role == "project_admin"
    assert agent.projects == ("b",)
    assert agent.disabled is True
    assert "b" in cfg.projects


def test_rotate_invalidates_old_token(tmp_path):
    path = str(tmp_path / "agents.yaml")
    old = agents_file.create_agent(path, "bot", "agent", ["a"])
    new = agents_file.rotate_token(path, "bot")
    cfg = load_config(path)
    assert hash_token(old) not in cfg.agents_by_hash
    assert cfg.agents_by_hash[hash_token(new)].id == "bot"


def test_delete_agent(tmp_path):
    path = str(tmp_path / "agents.yaml")
    token = agents_file.create_agent(path, "bot", "agent", ["a"])
    agents_file.delete_agent(path, "bot")
    assert hash_token(token) not in load_config(path).agents_by_hash


def test_unknown_agent_keyerror(tmp_path):
    path = str(tmp_path / "agents.yaml")
    agents_file.create_agent(path, "bot", "agent", ["a"])
    with pytest.raises(KeyError):
        agents_file.update_agent(path, "ghost", role="agent")
    with pytest.raises(KeyError):
        agents_file.rotate_token(path, "ghost")
    with pytest.raises(KeyError):
        agents_file.delete_agent(path, "ghost")
