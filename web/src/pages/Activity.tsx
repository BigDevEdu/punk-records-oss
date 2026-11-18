import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ActivityRow, ApiError, request } from "../api";
import { Select } from "../components/Select";
import { dayLabel, latency, outcomeLabel, toolLabel } from "../agents";
import type { LayoutCtx } from "../Layout";

const time = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function Activity() {
  const { agents, colorOf: color } = useOutletContext<LayoutCtx>();
  const [agent, setAgent] = useState("");
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);

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

  const shown = (rows ?? []).filter((r) => !onlyErrors || r.outcome !== "ok");
  const errors = (rows ?? []).filter((r) => r.outcome !== "ok").length;
  return (
    <>
      <div className="topbar">
        <span>Atividade</span>
        <span className="live muted"><i className="live-dot" aria-hidden />Ao vivo</span>
        <div className="grow" />
        <label className="check-inline">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
          Só erros{rows && <span className="muted"> ({errors})</span>}
        </label>
        <label className="muted" htmlFor="f-agente">Agente</label>
        <Select id="f-agente" label="Agente" value={agent} onChange={setAgent}
          options={[{ value: "", label: "Todos" }, ...agents.map((a) => ({ value: a.id, label: a.id }))]} />
      </div>
      {error && <p className="error pad" role="alert">{error}</p>}
      <div className="list-wrap">
        <div className="grouped"><table className="list activity">
          <thead><tr><th>Hora</th><th>Agente</th><th>Ação</th><th>Projetos</th><th>Resultados</th><th>Tempo</th><th>Resultado</th></tr></thead>
          <tbody>
            {shown.map((r, i) => {
              const day = dayLabel(r.ts);
              const head = i === 0 || dayLabel(shown[i - 1].ts) !== day;
              return [
              head && <tr key={`d-${day}`} className="day"><th colSpan={7} scope="rowgroup">{day}</th></tr>,
              <tr key={`${r.ts}-${r.agent_id}-${r.tool}`}>
                <td className="a-time muted">{time(r.ts)}</td>
                <td className="a-agent">{r.agent_id}</td>
                <td className="a-tool">{toolLabel(r.tool)}</td>
                <td className="a-proj">
                  {(r.projects ?? []).length === 0 ? <span className="muted">—</span> : (r.projects ?? []).map((p) => (
                    <span key={p} className="proj-chip"><span className="sq" style={{ background: color(p) }} />{p}</span>
                  ))}
                </td>
                <td className="a-n">{r.n_results == null ? <span className="muted">—</span> : `${r.n_results} resultados`}</td>
                <td className="a-ms muted">{latency(r.latency_ms)}</td>
                <td className="a-out"><span className={r.outcome === "ok" ? "badge success" : "badge danger"}>{outcomeLabel(r.outcome)}</span></td>
              </tr>,
              ];
            })}
            {rows && shown.length === 0 && <tr><td colSpan={7} className="muted">{onlyErrors ? "Nenhum erro." : "Nenhuma atividade ainda."}</td></tr>}
            {!rows && !error && <tr><td colSpan={7} className="muted">Carregando</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
