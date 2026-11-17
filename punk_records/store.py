import copy
import glob
import fcntl
import os

from epochdb import EpochDB

from punk_records.config import Settings


class StorageLocked(Exception):
    pass


def memory_to_dict(m, context_window: int | None = None) -> dict:
    """Serializa Memory. context_window==0 (ou None→sempre) descarta context_neighbors
    obsoletos que o retriever deixa gravados em atom.metadata."""
    md = copy.deepcopy(m.metadata)
    if not context_window:
        md.pop("context_neighbors", None)
    return {
        "id": m.id,
        "text": m.text,
        "score": m.score,
        "project": md.get("project"),
        "agent_id": md.get("agent_id"),
        "memory_type": m.memory_type,
        # EpochDB troca created_at a cada update; a data original fica na metadata.
        "created_at": md.get("created_at", m.created_at),
        "updated_at": m.created_at,
        "metadata": md,
    }


class MemoryStore:
    def _clean(self, rs, filters=None):
        # BUG upstream EpochDB 1.14.1 (retrieval.py ~L764-800): facet_winners (BM25) voltam ao pool
        # de rerank sem rechecar `filters` (aplicado em ~L543) nem `_deleted`. Reaplicamos aqui com
        # o próprio match_filters do EpochDB. ponytail: remover quando o upstream corrigir.
        keep = lambda m: not m.metadata.get("_deleted") and (
            not filters or self.db.retriever.match_filters(m.metadata, filters))
        return [m for m in rs if keep(m)]

    def __init__(self, settings: Settings):
        os.makedirs(settings.storage_dir, exist_ok=True)
        self._lock_path = os.path.join(settings.storage_dir, ".punk-records.lock")
        self._lock_fd = open(self._lock_path, "w")
        try:
            fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self._lock_fd.close()
            raise StorageLocked(f"storage em uso: {self._lock_path}")
        try:
            self.db = EpochDB(
                storage_dir=settings.storage_dir,
                embedding_model=settings.embedding_model,
                dim=settings.embedding_dim,
            )
        except BaseException:
            self._release()
            raise

    def _release(self):
        self._lock_fd.close()  # fechar o fd libera o flock

    def remember(self, text, metadata=None, memory_type=None) -> str:
        return self.db.remember(text, metadata=metadata, memory_type=memory_type)

    def query(self, text, k=5, filters=None, min_score=0.0, memory_type=None, context_window=0):
        rs = self.db.query(text, k=k, filters=filters, min_score=min_score,
                           memory_type=memory_type, context_window=context_window)
        return [memory_to_dict(m, context_window) for m in self._clean(rs, filters)]

    def multi_hop(self, text, hops=2, k=5, filters=None, context_window=0):
        rs = self.db.multi_hop(text, hops=hops, k=k, filters=filters, context_window=context_window)
        return [memory_to_dict(m, context_window) for m in self._clean(rs, filters)]

    def adaptive_query(self, text, k=5):
        return [memory_to_dict(m) for m in self._clean(self.db.adaptive_query(text, k=k))]

    def get(self, id):
        m = self.db.get(id)
        return memory_to_dict(m) if m else None

    def update(self, id, text=None, metadata=None) -> None:
        cur = self.db.get(id)
        if cur is None:
            raise KeyError(id)
        # Q3a: sempre texto explícito; metadata = só o patch do chamador
        self.db.update(id, text=text if text is not None else cur.text, metadata=metadata)

    def delete(self, id, hard=False) -> None:
        self.db.delete(id, hard=hard)

    def entity_graph(self, entity, depth=2) -> dict:
        g = self.db.entity_graph(entity, depth=depth)
        return {"nodes": g.nodes, "edges": g.edges, "node_types": g.node_types}

    def timeline(self, entity=None, start=None, end=None):
        return [memory_to_dict(m) for m in self.db.get_timeline(entity, start, end)]

    def sql(self, query):
        # Não usa db.query_sql: a conexão DuckDB do EpochDB lê e grava qualquer arquivo
        # (read_text, COPY TO). Aqui o cold tier vira uma tabela em memória e a conexão
        # roda sem acesso a arquivos, com a configuração travada.
        # ponytail: carrega todo o cold tier por consulta; paginar se o volume crescer.
        import duckdb
        import pyarrow.dataset as ds
        files = sorted(glob.glob(os.path.join(self.db.cold_tier.storage_dir, "*.parquet")))
        if not files:
            return []
        table = ds.dataset(files, format="parquet").to_table()
        con = duckdb.connect(config={"enable_external_access": False})
        try:
            con.register("cold_tier", table)
            con.execute("SET lock_configuration = true")
            cur = con.execute(query)
            cols = [d[0] for d in cur.description or []]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
        finally:
            con.close()

    def compact(self) -> None:
        self.db.compact()

    def close(self) -> None:
        try:
            self.db.close()
        finally:
            self._release()
