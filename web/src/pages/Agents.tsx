import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ApiError, AgentRow, post, projectColor, request } from "../api";
import type { LayoutCtx } from "../Layout";
import { relativeTime, statusOf } from "../agents";
import AgentPanel from "../components/AgentPanel";
import CreateAgent from "../components/CreateAgent";
import TokenOnce from "../components/TokenOnce";

type Side =
  | { k: "none" } | { k: "detail" } | { k: "create" } | { k: "edit" }
  | { k: "token"; id: string; token: string; rotated: boolean };
const LOCK_HINT = "Copie o token antes de continuar";
const DOT: Record<string, string> = { Ativo: "var(--p2)", Revogado: "var(--mu)", "Sem uso": "var(--p3)" };

export default function Agents() {
  const { agents, projects, me, reload } = useOutletContext<LayoutCtx>();
  const [sel, setSel] = useState<string | null>(null);
  const [side, setSide] = useState<Side>({ k: "none" });
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const agent = agents.find((a) => a.id === sel) ?? null;
  const rows = agents.filter((a) => a.id.includes(filter.trim().toLowerCase()));
  const colorOf = (n: string) => projectColor(projects.find((p) => p.name === n)?.color_index ?? 0);

  async function act(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); reload(); }
    catch (e) { setError(e instanceof ApiError ? e.detail : "Não foi possível falar com o servidor."); }
    finally { setBusy(false); }
  }
  const locked = side.k === "token";
  const select = (id: string) => { setSel(id); setSide({ k: "detail" }); setError(""); };
  const patch = (id: string, body: object) =>
    request(`/agents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });

  return (
    <>
      <div className="topbar">
        <span>Agentes</span><div className="grow" />
        <input className="field search" placeholder="Filtrar agentes" aria-label="Filtrar agentes"
          value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="primary auto" disabled={locked} title={locked ? LOCK_HINT : undefined}
          onClick={() => setSide({ k: "create" })}>Criar agente</button>
      </div>
      <div className="brain-body">
        <div className="list-wrap">
          <table className="list">
            <thead><tr><th>Agente</th><th>Papel</th><th>Projetos</th><th>Último uso</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((a: AgentRow) => {
                const st = statusOf(a);
                return (
                  <tr key={a.id} className={a.id === sel ? "sel" : ""}>
                    <td data-l="Agente">
                      <button className="link" disabled={locked} title={locked ? LOCK_HINT : undefined} aria-pressed={a.id === sel} onClick={() => select(a.id)}>{a.id}</button>
                    </td>
                    <td data-l="Papel"><span className="role">{a.role}</span></td>
                    <td data-l="Projetos">
                      {a.role === "global" ? <span className="muted">todos</span> : a.projects.length === 0 ? <span className="muted">nenhum</span> : (
                        <>
                          <span className="sq" style={{ background: colorOf(a.projects[0]) }} />{a.projects[0]}
                          {a.projects.length > 1 && <span className="muted"> +{a.projects.length - 1}</span>}
                        </>
                      )}
                    </td>
                    <td data-l="Último uso">{a.last_used_at == null ? <span className="muted">nunca</span> : relativeTime(a.last_used_at)}</td>
                    <td data-l="Status">
                      <span className={"status" + (st === "Revogado" ? " muted" : "")}><i style={{ background: DOT[st] }} />{st}</span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={5} className="muted">Nenhum agente encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
        {locked && <p className="sr-only" role="status">{LOCK_HINT}</p>}
        {side.k === "detail" && agent && (
          <AgentPanel agent={agent} isSelf={agent.id === me.agent_id} projects={projects} busy={busy} error={error}
            onClose={() => setSide({ k: "none" })} onEdit={() => setSide({ k: "edit" })}
            onRotate={() => act(async () => {
              const r = await post<{ token: string }>(`/agents/${encodeURIComponent(agent.id)}/token`);
              setSide({ k: "token", id: agent.id, token: r.token, rotated: true });
            })}
            onDisable={(d) => act(() => patch(agent.id, { disabled: d }).then(() => undefined))}
            onDelete={() => act(async () => {
              await request(`/agents/${encodeURIComponent(agent.id)}`, { method: "DELETE" });
              setSel(null); setSide({ k: "none" });
            })} />
        )}
        {side.k === "create" && (
          <div className="panel wide"><CreateAgent projects={projects} onCancel={() => setSide({ k: "none" })}
            onCreated={(id, token) => { setSel(id); setSide({ k: "token", id, token, rotated: false }); reload(); }} /></div>
        )}
        {side.k === "edit" && agent && (
          <div className="panel wide"><CreateAgent agent={agent} isSelf={agent.id === me.agent_id} projects={projects}
            onCancel={() => setSide({ k: "detail" })} onSaved={() => { setSide({ k: "detail" }); reload(); }} /></div>
        )}
        {side.k === "token" && (
          <div className="panel wide"><TokenOnce id={side.id} token={side.token} rotated={side.rotated}
            onClose={() => setSide({ k: "detail" })} /></div>
        )}
      </div>
    </>
  );
}
