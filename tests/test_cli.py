from punk_records.cli import main
from punk_records.config import hash_token, load_config


def test_new_creates_file_and_token(tmp_path, capsys):
    path = tmp_path / "agents.yaml"
    assert main(["token", "new", "bot", "--role", "agent",
                 "--projects", "a,b", "--file", str(path)]) == 0
    token = capsys.readouterr().out.strip()
    assert token.startswith("pr_")
    cfg = load_config(str(path))
    assert cfg.agents_by_hash[hash_token(token)].id == "bot"
    assert cfg.projects == {"a", "b"}


def test_new_rotates_existing(tmp_path, capsys):
    path = str(tmp_path / "agents.yaml")
    main(["token", "new", "bot", "--role", "agent", "--projects", "a", "--file", path])
    old = capsys.readouterr().out.strip()
    main(["token", "new", "bot", "--role", "agent", "--projects", "a", "--file", path])
    new = capsys.readouterr().out.strip()
    cfg = load_config(path)
    assert hash_token(old) not in cfg.agents_by_hash
    assert cfg.agents_by_hash[hash_token(new)].id == "bot"
    assert len(cfg.agents_by_hash) == 1


def test_list_hides_hash(tmp_path, capsys):
    path = str(tmp_path / "agents.yaml")
    main(["token", "new", "bot", "--role", "agent", "--projects", "a", "--file", path])
    token = capsys.readouterr().out.strip()
    assert main(["token", "list", "--file", path]) == 0
    out = capsys.readouterr().out
    assert "bot agent a false" in out
    assert hash_token(token) not in out
    assert "token_sha256" not in out


def test_revoke_disables(tmp_path, capsys):
    path = str(tmp_path / "agents.yaml")
    main(["token", "new", "bot", "--role", "agent", "--projects", "a", "--file", path])
    token = capsys.readouterr().out.strip()
    assert main(["token", "revoke", "bot", "--file", path]) == 0
    assert load_config(path).agents_by_hash[hash_token(token)].disabled is True


def test_invalid_role_returns_1(tmp_path, capsys):
    path = tmp_path / "agents.yaml"
    assert main(["token", "new", "bot", "--role", "x", "--file", str(path)]) == 1
    assert not path.exists()
    assert "papel invalido" in capsys.readouterr().err
