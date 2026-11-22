import re
import threading
from collections import Counter

import numpy as np

STOPWORDS = frozenset("""
a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sob sobre entre
e ou mas que se como mais menos muito muita já não sim ao aos à às pelo pela pelos pelas
este esta isto esse essa isso aquele aquela aquilo seu sua seus suas meu minha nosso nossa
ser foi são era está estão tem têm ter fazer feito pode podem deve ainda também quando onde
the an and or but of to in on at by for with from as is are was were be been being it its
this that these those not no do does did have has had will would can could should may might
i you he she we they them his her our your their what which who how when where there then than
""".split())

_WORD = re.compile(r"[^\W\d_]{3,}")


def _words(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower()) if w not in STOPWORDS]


def knn_edges(emb, k: int, min_sim: float) -> list[tuple[int, int, float]]:
    # ponytail: O(N²); índice ANN acima de ~10 mil
    emb = np.asarray(emb, dtype=np.float32)
    n = len(emb)
    if n < 2 or k < 1:
        return []
    norms = np.linalg.norm(emb, axis=1)
    ok = norms > 0
    unit = emb / np.where(ok, norms, 1)[:, None]
    sim = unit @ unit.T
    sim[~ok, :] = -2
    sim[:, ~ok] = -2
    np.fill_diagonal(sim, -2)
    best: dict[tuple[int, int], float] = {}
    for i in np.flatnonzero(ok):
        row = sim[i]
        for j in np.argsort(-row)[:k]:
            if row[j] < min_sim:
                break
            key = (min(i, j), max(i, j))
            best[key] = max(best.get(key, -2), float(row[j]))
    return sorted((int(i), int(j), round(w, 3)) for (i, j), w in best.items())


def clusters(n: int, edges, min_sim: float = 0.6, min_size: int = 3) -> list[list[int]]:
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, j, w in edges:
        if w >= min_sim:
            parent[find(i)] = find(j)
    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    out = [g for g in groups.values() if len(g) >= min_size]
    return sorted(out, key=lambda g: (-len(g), g[0]))


def cluster_label(texts_in, texts_all) -> str:
    inn = Counter(w for t in texts_in for w in _words(t))
    tot = Counter(w for t in texts_all for w in _words(t))
    top = sorted(inn, key=lambda w: (-inn[w] / tot[w], -inn[w], w))[:3]
    if len(top) < 2:
        return "".join(top)
    return ", ".join(top[:-1]) + " e " + top[-1]


def build_graph(records, emb, *, visible=None, projects=None, types=None, k=5, min_sim=0.55) -> dict:
    keep = [i for i, r in enumerate(records)
            if (visible is None or r["project"] in visible)
            and (not projects or r["project"] in projects)
            and (not types or r["memory_type"] in types)]
    recs = [records[i] for i in keep]
    edges = knn_edges(np.asarray(emb)[keep], k, min_sim) if keep else []
    deg = Counter(x for i, j, _ in edges for x in (i, j))
    texts = [r["text"] for r in recs]
    groups = clusters(len(recs), edges)
    return {
        "nodes": [{"id": r["id"], "text": r["text"][:160], "project": r["project"],
                   "agent_id": r["agent_id"], "memory_type": r["memory_type"],
                   "created_at": r["created_at"], "updated_at": r["updated_at"],
                   "degree": deg[i]} for i, r in enumerate(recs)],
        "edges": [{"source": recs[i]["id"], "target": recs[j]["id"], "sim": w} for i, j, w in edges],
        "clusters": [{"id": f"c{n}", "label": cluster_label([texts[i] for i in g], texts),
                      "node_ids": [recs[i]["id"] for i in g]} for n, g in enumerate(groups)],
        "total": len(recs),
    }


def similar_to(records, emb, id, *, visible=None, n=5) -> list[dict]:
    """As `n` memórias visíveis mais parecidas com `id` (kNN de uma linha só)."""
    emb = np.asarray(emb, dtype=np.float32)
    idx = next((i for i, r in enumerate(records) if r["id"] == id), None)
    if idx is None or not np.linalg.norm(emb[idx]):
        return []
    norms = np.linalg.norm(emb, axis=1)
    sims = emb @ emb[idx] / np.where(norms > 0, norms, 1) / np.linalg.norm(emb[idx])
    out = []
    for j in np.argsort(-sims):
        r = records[j]
        if j == idx or norms[j] == 0 or (visible is not None and r["project"] not in visible):
            continue
        out.append({"id": r["id"], "sim": round(float(sims[j]), 3), "text": r["text"][:160],
                    "project": r["project"]})
        if len(out) == n:
            break
    return out


class GraphCache:
    """Guarda os últimos MAX resultados por chave (descarta o mais antigo)."""

    MAX = 8

    def __init__(self):
        self._lock = threading.Lock()
        self._d: dict = {}

    def get(self, key):
        with self._lock:
            return self._d.get(key)

    def clear(self):
        with self._lock:
            self._d.clear()

    def put(self, key, value):
        with self._lock:
            self._d.pop(key, None)
            self._d[key] = value
            while len(self._d) > self.MAX:
                del self._d[next(iter(self._d))]
