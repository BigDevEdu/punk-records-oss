import { Plus } from "lucide-react";
import { useState } from "react";
import { ApiError, AgentRow, Project, post, request } from "../api";
import { ID_RE, ROLES, SELF_HINT, SHARED } from "../agents";
import { useOutletContext } from "react-router-dom";
import type { LayoutCtx } from "../Layout";

export default function CreateAgent({ agent, isSelf, projects, onCreated, onSaved, onCancel }: {
  agent?: AgentRow; isSelf?: boolean; projects: Project[];
  onCreated?: (id: string, token: string) => void; onSaved?: () => void; onCancel: () => void;
}) {
  const { colorOf } = useOutletContext<LayoutCtx>();
  const edit = !!agent;
  const [id, setId] = useState("");
  const [role, setRole] = useState(agent?.role ?? "agent");
  const [chosen, setChosen] = useState<string[]>(agent?.projects ?? []);
  const [extra, setExtra] = useState<string[]>([]);
  const [newName, setNewName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const known = projects.filter((p) => p.name !== SHARED);
  const names = [...known.map((p) => p.name), ...chosen.filter((c) => !known.some((p) => p.name === c)), ...extra]
    .filter((n, i, a) => a.indexOf(n) === i);
  const roleHint = ROLES.find((r) => r.id === role)!.hint;
  const toggle = (n: string) => setChosen(chosen.includes(n) ? chosen.filter((x) => x !== n) : [...chosen, n]);

  function addProject() {
    const n = (newName ?? "").trim();
    if (!ID_RE.test(n) || n === SHARED) { setError("Nome de projeto inválido: use letras minúsculas, números e hífen."); return; }
    setError("");
    if (!names.includes(n)) setExtra([...extra, n]);
    if (!chosen.includes(n)) setChosen([...chosen, n]);
    setNewName(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pid = edit ? agent!.id : id.trim();
    if (!ID_RE.test(pid)) { setError("Nome inválido: use 2 a 63 letras minúsculas, números ou hífen, começando por letra ou número."); return; }
    setBusy(true); setError("");
    const projs = role === "global" ? [] : chosen;
    try {
      if (edit) {
        await request(`/agents/${encodeURIComponent(pid)}`, { method: "PATCH", body: JSON.stringify({ role, projects: projs }) });
        onSaved?.();
      } else {
        const r = await post<{ token: string }>("/agents", { id: pid, role, projects: projs });
        onCreated?.(pid, r.token);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Não foi possível falar com o servidor.");
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>{edit ? `Editar ${agent!.id}` : "Criar agente"}</h3>
      <label htmlFor="ag-nome">Nome</label>
      <input id="ag-nome" className="field" value={edit ? agent!.id : id} readOnly={edit} autoFocus={!edit}
        autoComplete="off" onChange={(e) => setId(e.target.value)} placeholder="ex.: cursor-trabalho" />
      {!edit && <p className="muted hint">Letras minúsculas, números e hífen. Aparece na auditoria.</p>}
      <fieldset>
        <legend>Papel</legend>
        <div className="seg" role="radiogroup" aria-label="Papel">
          {ROLES.map((r) => {
            const blocked = !!isSelf && r.id !== "global";
            return (
              <label key={r.id} className={(role === r.id ? "on " : "") + (blocked ? "off" : "")}>
                <input type="radio" name="papel" value={r.id} checked={role === r.id} disabled={blocked}
                  onChange={() => setRole(r.id)} />{r.label}
              </label>
            );
          })}
        </div>
        <p className="muted hint">{roleHint}</p>
        {isSelf && <p className="muted hint">{SELF_HINT}</p>}
      </fieldset>
      {role !== "global" && (
        <fieldset>
          <legend>Projetos</legend>
          {names.map((n) => (
            <label key={n} className="check">
              <input type="checkbox" checked={chosen.includes(n)} onChange={() => toggle(n)} />
              <span className="sq" style={{ background: colorOf(n) }} />{n}
            </label>
          ))}
          {newName === null ? (
            <button type="button" className="plain add" onClick={() => setNewName("")}><Plus size={14} aria-hidden />Novo projeto</button>
          ) : (
            <div className="row">
              <input className="field" aria-label="Nome do novo projeto" value={newName} autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addProject(); } }} />
              <button type="button" className="plain" onClick={addProject}>Adicionar</button>
            </div>
          )}
        </fieldset>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row end">
        <button type="button" className="plain" onClick={onCancel}>Cancelar</button>
        <button className="primary auto" disabled={busy}>{edit ? "Salvar alterações" : "Criar agente"}</button>
      </div>
    </form>
  );
}
