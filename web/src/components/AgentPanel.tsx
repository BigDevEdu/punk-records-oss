import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, Eye, KeyRound, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useOutletContext } from "react-router-dom";
import { AgentRow, Project } from "../api";
import type { LayoutCtx } from "../Layout";
import { SELF_HINT, SHARED, permissions, relativeTime, roleLabel } from "../agents";

const fmt = new Intl.NumberFormat("pt-BR");

export default function AgentPanel({ agent, isSelf, projects, busy, error, onEdit, onRotate, onDisable, onDelete, onClose }: {
  agent: AgentRow; isSelf: boolean; projects: Project[]; busy: boolean; error: string;
  onEdit: () => void; onRotate: () => void; onDisable: (disabled: boolean) => void; onDelete: () => void; onClose: () => void;
}) {
  const nav = useNavigate();
  const [confirm, setConfirm] = useState<"" | "revoke" | "delete">("");
  useEffect(() => setConfirm(""), [agent.id]);
  const color = useOutletContext<LayoutCtx>().colorOf;
  const perms = permissions(agent.role, agent.projects, projects);
  const lock = isSelf ? SELF_HINT : undefined;
  const last = agent.last_used_at == null ? "nunca"
    : `${new Date(agent.last_used_at * 1000).toLocaleString("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} (${relativeTime(agent.last_used_at)})`;

  return (
    <aside className="panel agent-panel" aria-label={`Agente ${agent.id}`}>
      <button className="plain icon close" onClick={onClose} aria-label="Fechar detalhe"><X size={16} aria-hidden /></button>
      <div className="mem-text">{agent.id}</div>
      <table className="kv"><tbody>
        <tr><td>Papel</td><td><span className="badge">{roleLabel(agent.role)}</span></td></tr>
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
        <button className="plain" onClick={() => nav(`/?as=${encodeURIComponent(agent.id)}`)}><Eye size={14} aria-hidden />Ver o cérebro como este agente</button>
        <button className="plain" onClick={onEdit}><Pencil size={14} aria-hidden />Editar papel e projetos</button>
        <button className="plain" disabled={isSelf || busy} data-tip={lock} onClick={onRotate}><KeyRound size={14} aria-hidden />Gerar novo token</button>
        {agent.disabled ? (
          <button className="plain" disabled={isSelf || busy} data-tip={lock} onClick={() => onDisable(false)}>
            <RotateCcw size={14} aria-hidden />Reativar
          </button>
        ) : (
          <button className="plain" disabled={isSelf || busy} data-tip={lock} aria-expanded={confirm === "revoke"} onClick={() => setConfirm("revoke")}>
            <Ban size={14} aria-hidden />Revogar acesso
          </button>
        )}
        {confirm === "revoke" && (
          <div className="confirm" role="alertdialog" aria-label="Confirmar revogação">
            <p>Revogar o acesso de {agent.id}? As chamadas dele passam a ser recusadas na hora. Dá para reativar depois.</p>
            <div className="row">
              <button className="plain" autoFocus onClick={() => setConfirm("")}>Cancelar</button>
              <button className="plain danger" disabled={busy} onClick={() => { setConfirm(""); onDisable(true); }}><Ban size={14} aria-hidden />Revogar acesso</button>
            </div>
          </div>
        )}
        <div className="danger-zone">
          <button className="plain danger" disabled={isSelf || busy} data-tip={lock} onClick={() => setConfirm("delete")}><Trash2 size={14} aria-hidden />Excluir agente</button>
          <p className="muted hint">Apaga o agente e o token. As memórias dele continuam.</p>
        </div>
        {isSelf && <p className="muted hint">{SELF_HINT}</p>}
        {confirm === "delete" && (
          <div className="confirm" role="alertdialog" aria-label="Confirmar exclusão">
            <p>Excluir o agente {agent.id}? As memórias dele continuam.</p>
            <div className="row">
              <button className="plain" autoFocus onClick={() => setConfirm("")}>Cancelar</button>
              <button className="plain danger" disabled={busy} onClick={() => { setConfirm(""); onDelete(); }}><Trash2 size={14} aria-hidden />Excluir agente</button>
            </div>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </aside>
  );
}
