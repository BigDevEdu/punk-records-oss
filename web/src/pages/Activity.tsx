import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ActivityRow, ApiError, projectColor, request } from "../api";
import type { LayoutCtx } from "../Layout";

const time = (ts: number) =>
  new Date(ts * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function Activity() {
  const { agents, projects } = useOutletContext<LayoutCtx>();
  const [agent, setAgent] = useState("");
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.hidden) return;
      request<ActivityRow[]>(`/activity?limit=200` + (agent ? `&agent=${encodeURIComponent(agent)}` : ""))
        .then((r) => { if (live) { setRows(r); setError(""); } })
        .catch((e) => live && setError(e instanceof ApiError ? e.detail : "Não foi possível falar com o servidor."));
    };
    load();
    const t = setInterval(load, 10_000);
    return () => { live = false; clearInterval(t); };
  }, [agent]);

  const color = (n: string) => projectColor(projects.find((p) => p.name === n)?.color_index ?? 0);
  return (
    <>
      <div className="topbar">
        <span>Atividade</span><div className="grow" />
        <label className="muted" htmlFor="f-agente">Agente</label>
        <select id="f-agente" className="field as-select" value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">Todos</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
        </select>
      </div>
      {error && <p className="error pad" role="alert">{error}</p>}
      <div className="list-wrap">
        <table className="list">
          <thead><tr><th>Hora</th><th>Agente</th><th>Ação</th><th>Projetos</th><th>Resultados</th><th>Resultado</th></tr></thead>
          <tbody>
            {(rows ?? []).map((r, i) => (
              <tr key={`${r.ts}-${i}`}>
                <td data-l="Hora">{time(r.ts)}</td>
                <td data-l="Agente">{r.agent_id}</td>
                <td data-l="Ação">{r.tool}</td>
                <td data-l="Projetos">
                  {r.projects.length === 0 ? <span className="muted">—</span> : r.projects.map((p) => (
                    <span key={p} className="proj-chip"><span className="sq" style={{ background: color(p) }} />{p}</span>
                  ))}
                </td>
                <td data-l="Resultados">{r.n_results ?? "—"}</td>
                <td data-l="Resultado" className={r.outcome === "ok" ? "" : "danger"}>{r.outcome}</td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan={6} className="muted">Nenhuma atividade ainda.</td></tr>}
            {!rows && !error && <tr><td colSpan={6} className="muted">Carregando</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
