import os

import pytest

from punk_records.config import Settings
from punk_records.store import MemoryStore


@pytest.fixture
def store(tmp_path):
    s = MemoryStore(Settings(
        storage_dir=str(tmp_path),
        embedding_model=os.getenv("PR_TEST_EMBEDDING_MODEL", "all-MiniLM-L6-v2"),
        embedding_dim=384,
    ))
    yield s
    s.close()
