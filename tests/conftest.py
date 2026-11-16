import json
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


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def call_tool(server, agent, name: str, **args):
    """Executa uma tool como `agent` e devolve o resultado JSON (dict ou list)."""
    from punk_records.server import current_agent

    token = current_agent.set(agent)
    try:
        r = await server.call_tool(name, args)
    finally:
        current_agent.reset(token)
    sc = r.structured_content
    if sc is None:  # tools anotadas com `-> dict` devolvem só texto JSON
        return json.loads(r.content[0].text)
    return sc["result"]
