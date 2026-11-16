import threading

import pytest

from punk_records.config import Settings
from punk_records.store import MemoryStore, StorageLocked


def test_remember_then_get_roundtrip(store):
    i = store.remember("o céu é azul", {"project": "a", "agent_id": "x", "tag": "t"}, None)
    m = store.get(i)
    assert m["text"] == "o céu é azul"
    assert m["project"] == "a" and m["agent_id"] == "x"
    assert m["metadata"]["tag"] == "t"


def test_query_respects_filters(store):
    store.remember("gatos gostam de peixe", {"project": "a"}, None)
    store.remember("gatos gostam de leite", {"project": "b"}, None)
    rs = store.query("gatos", 5, {"project": "a"}, 0.0, None, 0)
    assert rs and all(r["project"] == "a" for r in rs)


def test_query_without_context_window_has_no_neighbors(store):
    for t in ("maçã vermelha", "maçã verde", "maçã amarela"):
        store.remember(t, {"project": "a"}, None)
    store.query("maçã", 3, {"project": "a"}, 0.0, None, 2)
    rs = store.query("maçã", 3, {"project": "a"}, 0.0, None, 0)
    assert rs and all("context_neighbors" not in r["metadata"] for r in rs)


def test_second_store_same_dir_raises(store):
    with pytest.raises(StorageLocked, match=r"\.punk-records\.lock"):
        MemoryStore(Settings(storage_dir=store.db.storage_dir if hasattr(store.db, "storage_dir") else store._lock_path.rsplit("/", 1)[0]))


def test_concurrent_writes(store):
    ids, lock = [], threading.Lock()

    def w(n):
        i = store.remember(f"fato {n}", {"project": "a"}, None)
        with lock:
            ids.append(i)

    ts = [threading.Thread(target=w, args=(n,)) for n in range(20)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(ids) == 20 and all(store.get(i) is not None for i in ids)


def test_soft_delete_hides_from_get(store):
    i = store.remember("temporário", {"project": "a"}, None)
    store.delete(i, False)
    assert store.get(i) is None


def test_update_keeps_text_when_only_metadata(store):
    i = store.remember("texto original", {"project": "a"}, None)
    store.update(i, None, {"extra": 1})
    m = store.get(i)
    assert m["text"] == "texto original"
    assert m["metadata"]["extra"] == 1 and m["project"] == "a"
