import pytest

from punk_records import agents_file
from punk_records.config import ConfigError, hash_token, load_config


def test_create_agent_creates_file(tmp_path):
    path = str(tmp_path / "agents.yaml")
    token = agents_file.create_agent(path, "bot", "agent", ["proj-a"])
    cfg = load_config(path)
    assert cfg.agents_by_hash[hash_token(token)].id == "bot"
    assert cfg.projects == {"proj-a"}


def test_create_duplicate_id_raises(tmp_path):
    path = str(tmp_path / "agents.yaml")
    agents_file.create_agent(path, "bot", "agent", ["proj-a"])
    with pytest.raises(ConfigError):
        agents_file.create_agent(path, "bot", "agent", ["proj-a"])


def test_invalid_id_raises(tmp_path):
    path = tmp_path / "agents.yaml"
    with pytest.raises(ConfigError):
        agents_file.create_agent(str(path), "Bad_Id", "agent", [])
    with pytest.raises(ConfigError):
        agents_file.create_agent(str(path), "bot", "agent", ["_shared"])
    assert not path.exists()


@pytest.mark.parametrize("project", ["Bad Name", "a", "../x"])
def test_invalid_project_name_raises(tmp_path, project):
    path = str(tmp_path / "agents.yaml")
    agents_file.create_agent(path, "bot", "agent", ["ok-proj"])
    with pytest.raises(ConfigError):
        agents_file.create_agent(path, "other", "agent", [project])
    with pytest.raises(ConfigError):
        agents_file.update_agent(path, "bot", projects=[project])
    assert "other" not in [a.id for a in load_config(path).agents_by_hash.values()]


def test_save_failure_leaves_no_temp(tmp_path):
    path = str(tmp_path / "agents.yaml")
    agents_file.create_agent(path, "bot", "agent", ["a-proj"])
    before = (tmp_path / "agents.yaml").read_text()
    raw = agents_file.load_raw(path)
    raw["agents"][0]["role"] = "x"
    with pytest.raises(ConfigError):
        agents_file.save(path, raw)
    assert list(tmp_path.glob("*.tmp")) == []
    assert (tmp_path / "agents.yaml").read_text() == before


def test_update_role_projects_disabled(tmp_path):
    path = str(tmp_path / "agents.yaml")
    token = agents_file.create_agent(path, "bot", "agent", ["proj-a"])
    agents_file.update_agent(path, "bot", role="project_admin", projects=["proj-b"], disabled=True)
    cfg = load_config(path)
    agent = cfg.agents_by_hash[hash_token(token)]
    assert agent.role == "project_admin"
    assert agent.projects == ("proj-b",)
    assert agent.disabled is True
    assert "proj-b" in cfg.projects


def test_rotate_invalidates_old_token(tmp_path):
    path = str(tmp_path / "agents.yaml")
    old = agents_file.create_agent(path, "bot", "agent", ["proj-a"])
    new = agents_file.rotate_token(path, "bot")
    cfg = load_config(path)
    assert hash_token(old) not in cfg.agents_by_hash
    assert cfg.agents_by_hash[hash_token(new)].id == "bot"


def test_delete_agent(tmp_path):
    path = str(tmp_path / "agents.yaml")
    token = agents_file.create_agent(path, "bot", "agent", ["proj-a"])
    agents_file.delete_agent(path, "bot")
    assert hash_token(token) not in load_config(path).agents_by_hash


def test_unknown_agent_keyerror(tmp_path):
    path = str(tmp_path / "agents.yaml")
    agents_file.create_agent(path, "bot", "agent", ["proj-a"])
    with pytest.raises(KeyError):
        agents_file.update_agent(path, "ghost", role="agent")
    with pytest.raises(KeyError):
        agents_file.rotate_token(path, "ghost")
    with pytest.raises(KeyError):
        agents_file.delete_agent(path, "ghost")
