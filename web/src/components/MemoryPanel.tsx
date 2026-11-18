import { useEffect, useState } from "react";
import { Eye, Pencil, Trash2, X } from "lucide-react";
import { ApiError, MemoryDetail, request } from "../api";
import { typeLabel } from "../agents";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const fmtDate = (ts: number) => {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${p(d.getHours())}:${p(d.getMinutes())}`;
};

type Props = {
  id: string; as: string | null; color: (project: string) => string;
  onClose: () => void; onSelect: (id: string) => void; onChanged: () => void;
};

export default function MemoryPanel({ id, as, color, onClose, onSelect, onChanged }: Props) {
  const [m, setM] = useState<MemoryDetail | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.detail : "Não foi possível falar com o servidor.");

  useEffect(() => {
    let live = true;
    setM(null); setError(""); setMode("view");
    request<MemoryDetail>(`/memories/${encodeURIComponent(id)}` + (as ? `?as=${encodeURIComponent(as)}` : ""))
      .then((r) => live && setM(r)).catch((e) => live && fail(e));
    return () => { live = false; };
  }, [id, as, attempt]);

  async function save() {
    setBusy(true); setError("");
    try {
      await request(`/memories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ text: draft }) });
      onChanged(); setAttempt(attempt + 1);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError("");
    try {
      await request(`/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
      onChanged(); onClose();
    } catch (e) { fail(e); setBusy(false); }
  }

  return (
    <aside className="panel" aria-label="Detalhe da memória">
      <button className="plain icon close" onClick={onClose} aria-label="Fechar detalhe"><X size={16} aria-hidden /></button>
      {as && <div className="band"><Eye size={14} aria-hidden />Vendo como {as}</div>}
      {error && (
        <>
          <p className="error" role="alert">{error}</p>
          {!m && <button className="plain" onClick={() => setAttempt(attempt + 1)}>Tentar de novo</button>}
        </>
      )}
      {!m && !error && <div className="muted">Carregando</div>}
      {m && (
        <>
          {mode === "edit" ? (
            <>
              <label className="muted" htmlFor="edit-text">Texto da memória</label>
              <textarea id="edit-text" className="field" rows={7} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <div className="row">
                <button className="plain" disabled={busy || !draft.trim()} onClick={save}>Salvar</button>
                <button className="plain" disabled={busy} onClick={() => setMode("view")}>Cancelar</button>
              </div>
            </>
          ) : (
            <div className="mem-text">{m.text}</div>
          )}
          <table>
            <tbody>
              <tr><td>Projeto</td><td><span className="sq" style={{ background: color(m.project) }} />{m.project}</td></tr>
              <tr><td>Autor</td><td>{m.agent_id}</td></tr>
              <tr><td>Tipo</td><td>{typeLabel(m.memory_type)}</td></tr>
              <tr><td>Criada</td><td>{fmtDate(m.created_at)}</td></tr>
              <tr><td>Editada</td><td>{fmtDate(m.updated_at)}</td></tr>
            </tbody>
          </table>
          {m.similar.length > 0 && (
            <>
              <div className="muted sub">Memórias parecidas</div>
              <table>
                <tbody>
                  {m.similar.map((s) => (
                    <tr key={s.id}>
                      <td>{Math.round(s.sim * 100)}%</td>
                      <td><button className="link" onClick={() => onSelect(s.id)}>{s.text}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {!as && mode === "view" && (
            <div className="row">
              <button className="plain" onClick={() => { setDraft(m.text); setMode("edit"); }}><Pencil size={14} aria-hidden />Editar</button>
              <button className="plain danger" onClick={() => setMode("confirm")}><Trash2 size={14} aria-hidden />Apagar</button>
            </div>
          )}
          {!as && mode === "confirm" && (
            <div className="confirm" role="alertdialog" aria-label="Confirmar exclusão">
              <p>Apagar esta memória?</p>
              <div className="row">
                <button className="plain danger" disabled={busy} onClick={remove}><Trash2 size={14} aria-hidden />Apagar</button>
                <button className="plain" disabled={busy} onClick={() => setMode("view")}>Cancelar</button>
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
