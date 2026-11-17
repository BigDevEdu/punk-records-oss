import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentRow, Project, projectColor } from "../api";
import { SELF_HINT, SHARED, permissions, relativeTime } from "../agents";

const fmt = new Intl.NumberFormat("pt-BR");

export default function AgentPanel({ agent, isSelf, projects, busy, error, onEdit, onRotate, onDisable, onDelete, onClose }: {
  agent: AgentRow; isSelf: boolean; projects: Project[]; busy: boolean; error: string;
  onEdit: () => void; onRotate: () => void; onDisable: (disabled: boolean) => void; onDelete: () => void; onClose: () => void;
}) {
  const nav = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const color = (n: string) => projectColor(projects.find((p) => p.name === n)?.color_index ?? 0);
  const perms = permissions(agent.role, agent.projects, projects);
  const lock = isSelf ? SELF_HINT : undefined;
  const last = agent.last_used_at == null ? "nunca"
    : `${new Date(agent.last_used_at * 1000).toLocaleString("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} (${relativeTime(agent.last_used_at)})`;

  return (
    <aside className="panel agent-panel" aria-label={`Agente ${agent.id}`}>
      <button className="plain close" onClick={onClose} aria-label="Fechar detalhe">Fechar</button>
      <div className="mem-text">{agent.id}</div>
      <table className="kv"><tbody>
        <tr><td>Papel</td><td>{agent.role}</td></tr>
        <tr><td>Memórias</td><td>{fmt.format(agent.memory_count)} gravadas</td></tr>
        <tr><td>Último uso</td><td>{last}</td></tr>
      </tbody></table>
      <div className="muted sub">O que este agente pode fazer</div>
      <div className="perm">
        <span className="h">Projeto</span><span className="h">Ler</span><span className="h">Editar</span>
        {perms.map((p) => (
          <div key={p.project} className="perm-row">
            <span><span className="sq" style={{ background: color(p.project) }} />{p.project}</span>
            <span className="yes">{p.read}</span><span>{p.edit}</span>
          </div>
        ))}
        {agent.role !== "global" && (
          <div className="perm-row muted"><span>outros projetos</span><span>não</span><span>não</span></div>
        )}
      </div>
      <div className="actions">
        <button className="plain" onClick={() => nav(`/?as=${encodeURIComponent(agent.id)}`)}>Ver o cérebro como este agente</button>
        <button className="plain" onClick={onEdit}>Editar papel e projetos</button>
        <button className="plain" disabled={isSelf || busy} title={lock} onClick={onRotate}>Gerar novo token</button>
        <div className="row">
          <button className="plain grow" disabled={isSelf || busy} title={lock} onClick={() => onDisable(!agent.disabled)}>
            {agent.disabled ? "Reativar" : "Revogar"}
          </button>
          <button className="plain grow danger" disabled={isSelf || busy} title={lock} onClick={() => setConfirm(true)}>Excluir</button>
        </div>
        {isSelf && <p className="muted hint">{SELF_HINT}</p>}
        {confirm && (
          <div className="confirm" role="alertdialog" aria-label="Confirmar exclusão">
            <p>Excluir o agente {agent.id}? As memórias dele continuam.</p>
            <div className="row">
              <button className="plain" onClick={() => setConfirm(false)}>Cancelar</button>
              <button className="plain danger" disabled={busy} onClick={() => { setConfirm(false); onDelete(); }}>Excluir agente</button>
            </div>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </aside>
  );
}
