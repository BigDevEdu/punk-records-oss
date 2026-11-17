import copy
import glob
import fcntl
import os

import numpy as np
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

    def find(self, id):
        """Como get, mas acha também memórias com soft delete (para o delete definitivo).
        Devolve {id, metadata} ou None se não existe ou já foi apagada de vez."""
        db = self.db
        with db._internal_lock:
            if id in db.deleted_atom_ids:
                return None
            atom = db.hot_tier.atoms.get(id)
            if atom is None:
                found = [a for e in db.cold_tier.get_all_epochs()
                         for a in db.cold_tier.load_atom_metadata(e, [id])]
                if not found:
                    return None
                atom = max(found, key=lambda a: a.created_at)
            return {"id": atom.id, "metadata": copy.deepcopy(atom.metadata or {})}

    def all_live(self):
        """(registros, matriz float32 (n, dim)) de todas as memórias vivas, mesma ordem."""
        db = self.db
        with db._internal_lock:
            newest = {}
            atoms = list(db.hot_tier.atoms.values())
            for e in db.cold_tier.get_all_epochs():
                atoms.extend(db.cold_tier.load_epoch(e))
            for a in atoms:
                cur = newest.get(a.id)
                if cur is None or a.created_at > cur.created_at:
                    newest[a.id] = a
            live = [a for a in newest.values()
                    if not (a.metadata or {}).get("_deleted") and a.id not in db.deleted_atom_ids]
            recs = []
            for a in live:
                md = copy.deepcopy(a.metadata or {})
                md.pop("context_neighbors", None)
                recs.append({
                    "id": a.id, "text": str(a.payload), "project": md.get("project"),
                    "agent_id": md.get("agent_id"), "memory_type": a.memory_type,
                    "created_at": md.get("created_at", a.created_at),
                    "updated_at": a.created_at, "metadata": md,
                })
            if not live:
                return [], np.zeros((0, db.dim), np.float32)
            return recs, np.stack([np.asarray(a.embedding, np.float32) for a in live])

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
        # O EpochDB não apaga do Parquet no delete definitivo (nem no compact): esconde aqui.
        deleted = list(self.db.deleted_atom_ids)
        if deleted:
            import pyarrow as pa
            import pyarrow.compute as pc
            table = table.filter(pc.invert(pc.is_in(table["id"], value_set=pa.array(deleted))))
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
