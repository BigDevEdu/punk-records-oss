import dataclasses
import io
import json
import tarfile

import pytest
from starlette.testclient import TestClient

from punk_records import backup
from punk_records.server import build_app
from test_admin import G, MutableConfig
from test_server import SETTINGS


def test_snapshot_e_restore_voltam_o_estado(store, tmp_path):
    agents = tmp_path.parent / f"{tmp_path.name}-agents.yaml"
    agents.write_text("projects: [alpha]\nagents: []\n")
    old = store.remember("memoria antiga", metadata={"project": "alpha"})
    snap = backup.snapshot(store, str(agents), str(tmp_path.parent))
    new = store.remember("memoria nova", metadata={"project": "alpha"})
    agents.write_text("projects: [beta]\nagents: []\n")

    backup.restore_from(store, str(agents), snap)

    assert store.get(old) is not None
    assert store.get(new) is None
    assert "alpha" in agents.read_text()
    assert (tmp_path / backup.PRE_RESTORE / "agents.yaml").exists()
    store.remember("continua gravando depois do restore")


def test_restore_recusa_tar_que_sai_da_pasta(store, tmp_path):
    bad = tmp_path.parent / f"{tmp_path.name}-bad.tar.gz"
    with tarfile.open(bad, "w:gz") as tar:
        info = tarfile.TarInfo("../fora.txt")
        info.size = 2
        tar.addfile(info, io.BytesIO(b"oi"))
    keep = store.remember("fica")
    with pytest.raises(backup.BackupError):
        backup.restore_from(store, str(tmp_path / "agents.yaml"), bad)
    assert not (tmp_path.parent / "fora.txt").exists()
    assert store.get(keep) is not None


def test_restore_recusa_arquivo_que_nao_e_backup(store, tmp_path):
    bad = tmp_path.parent / f"{tmp_path.name}-x.tar.gz"
    with tarfile.open(bad, "w:gz") as tar:
        info = tarfile.TarInfo("data/qualquer.txt")
        tar.addfile(info, io.BytesIO(b""))
    with pytest.raises(backup.BackupError, match="não é um backup"):
        backup.restore_from(store, str(tmp_path / "agents.yaml"), bad)


def test_due():
    cfg = {**backup.DEFAULTS, "refresh_token": "r", "interval_hours": 1, "last_run": 1000}
    assert not backup.due(cfg, 1000 + 3599)
    assert backup.due(cfg, 1000 + 3600)
    assert not backup.due({**cfg, "interval_hours": 0}, 10**9)
    assert not backup.due({**cfg, "refresh_token": ""}, 10**9)


@pytest.fixture
def client(store, tmp_path):
    web = tmp_path.parent / f"{tmp_path.name}-web"
    web.mkdir()
    s = dataclasses.replace(SETTINGS, backup_file=str(web / "backup.json"))
    with TestClient(build_app(s, MutableConfig(G), store, web_dir=str(web)),
                    base_url="https://testserver") as c:
        c.post("/admin/api/login", json={"token": "g"})
        c.backup_file = s.backup_file
        yield c


def test_config_nao_vaza_segredo(client):
    r = client.put("/admin/api/backup", json={"client_id": "cid", "client_secret": "SEGREDO",
                                              "interval_hours": 24, "keep": 5})
    assert r.status_code == 200
    body = client.get("/admin/api/backup").json()
    assert "SEGREDO" not in json.dumps(body)
    assert body["has_secret"] and body["interval_hours"] == 24 and body["keep"] == 5
    assert body["redirect_uri"].endswith("/admin/api/backup/google/callback")
    # secret vazio mantém o salvo
    client.put("/admin/api/backup", json={"client_secret": ""})
    assert backup.load(client.backup_file)["client_secret"] == "SEGREDO"


def test_config_valida_numeros(client):
    assert client.put("/admin/api/backup", json={"keep": 0}).status_code == 400
    assert client.put("/admin/api/backup", json={"interval_hours": "x"}).status_code == 400


def test_connect_exige_credenciais_e_callback_exige_state(client):
    r = client.post("/admin/api/backup/google/connect", json={})
    assert r.status_code == 400 and "Client ID" in r.json()["detail"]
    client.put("/admin/api/backup", json={"client_id": "cid", "client_secret": "s"})
    url = client.post("/admin/api/backup/google/connect", json={}).json()["url"]
    assert "drive.file" in url and "state=" in url
    r = client.get("/admin/api/backup/google/callback?state=falso&code=x")
    assert r.status_code == 400


def test_backup_exige_login(store, tmp_path):
    with TestClient(build_app(SETTINGS, MutableConfig(G), store, web_dir=str(tmp_path)),
                    base_url="https://testserver") as c:
        assert c.get("/admin/api/backup").status_code == 401
        assert c.post("/admin/api/backup/run", json={}).status_code == 401
