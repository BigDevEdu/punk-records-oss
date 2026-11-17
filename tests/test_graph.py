import numpy as np

from punk_records.graph import build_graph, cluster_label, clusters, knn_edges


def _unit(*v):
    a = np.array(v, dtype=np.float32)
    return a / np.linalg.norm(a)


def test_knn_edges_symmetric_and_threshold():
    emb = np.stack([_unit(1, 0), _unit(1, 0.1), _unit(0, 1), np.zeros(2)]).astype(np.float32)
    es = knn_edges(emb, k=2, min_sim=0.5)
    assert [(i, j) for i, j, _ in es] == [(0, 1)]
    assert all(i < j for i, j, _ in es) and es[0][2] == round(es[0][2], 3)


def test_clusters_components_min_size():
    edges = [(0, 1, 0.9), (1, 2, 0.8), (3, 4, 0.9), (2, 5, 0.3)]
    assert clusters(6, edges, min_sim=0.6, min_size=3) == [[0, 1, 2]]


def test_cluster_label_picks_distinctive_words():
    inn = ["deploy no dokploy", "dokploy com traefik", "deploy dokploy ok"]
    allt = inn + ["banco de dados postgres", "backup do banco postgres", "banco lento"]
    assert "dokploy" in cluster_label(inn, allt)


def _rec(i, project):
    return {"id": f"m{i}", "text": f"t{i}", "project": project, "agent_id": "a",
            "memory_type": None, "created_at": 0, "updated_at": 0, "metadata": {}}


def test_build_graph_visible_filters_before_knn():
    recs = [_rec(0, "a"), _rec(1, "a"), _rec(2, "secret")]
    emb = np.stack([_unit(1, 0), _unit(1, 0.1), _unit(1, 0.05)]).astype(np.float32)
    g = build_graph(recs, emb, visible=frozenset({"a"}))
    assert {n["id"] for n in g["nodes"]} == {"m0", "m1"}
    assert all("m2" not in (e["source"], e["target"]) for e in g["edges"])
    assert g["total"] == 2 and {n["degree"] for n in g["nodes"]} == {1}


def test_build_graph_small_inputs():
    empty = build_graph([], np.zeros((0, 2), np.float32))
    assert empty["nodes"] == [] and empty["edges"] == [] and empty["total"] == 0
    one = build_graph([_rec(0, "a")], np.ones((1, 2), np.float32))
    assert len(one["nodes"]) == 1 and one["edges"] == [] and one["clusters"] == []
