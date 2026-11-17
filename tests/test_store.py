import threading

import numpy as np
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


def test_query_drops_soft_deleted_even_if_bm25_winner(store):
    i = store.remember("zorblax zorblax distintivo único", {"project": "a"}, None)
    store.remember("zorblax apenas citado de passagem", {"project": "a"}, None)
    store.delete(i)
    rs = store.query("zorblax", 5, {"project": "a"}, 0.0, None, 0)
    assert i not in [r["id"] for r in rs]


def test_query_filter_holds_for_bm25_winner(store):
    store.remember("quuxplorer raro do projeto a", {"project": "a"}, None)
    store.remember("quuxplorer quuxplorer quuxplorer", {"project": "b"}, None)
    rs = store.query("quuxplorer", 5, {"project": "a"}, 0.0, None, 0)
    assert rs and all(r["project"] == "a" for r in rs)


def test_all_live_skips_old_versions_of_deleted(store):
    a = store.remember("primeira", {"project": "p"}, None)
    store.db.flush()
    store.delete(a, False)
    b = store.remember("segunda", {"project": "p"}, None)
    store.db.flush()
    store.delete(b, True)
    c = store.remember("terceira", {"project": "p"}, None)
    recs, emb = store.all_live()
    assert [r["id"] for r in recs] == [c] and emb.shape == (1, 384)


def test_all_live_matrix_aligned(store):
    ids = [store.remember(t, {"project": "p", "agent_id": "x"}, None) for t in ("um", "dois", "três")]
    store.db.flush()
    ids.append(store.remember("quatro", {"project": "p"}, None))
    recs, emb = store.all_live()
    assert sorted(r["id"] for r in recs) == sorted(ids)
    assert emb.shape == (4, 384) and emb.dtype == "float32"
    r = recs[0]
    assert r["project"] == "p" and "context_neighbors" not in r["metadata"] and "score" not in r
    assert {r["text"] for r in recs} == {"um", "dois", "três", "quatro"}
    enc = store.db._get_embedder()
    for rec, row in zip(recs, emb):
        e = enc.encode(rec["text"], is_query=False, normalize_embeddings=True)
        assert float(np.dot(e, row)) > 0.99
