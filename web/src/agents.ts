import type { AgentRow, Project } from "./api";

export const ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const SELF_HINT = "Você não pode alterar o agente da sua própria sessão.";
export const SHARED = "_shared";

export const ROLES = [
  { id: "agent", label: "Agente", hint: "Lê os projetos marcados e o _shared. Edita só as próprias memórias." },
  { id: "project_admin", label: "Admin de projeto", hint: "Lê os projetos marcados e o _shared. Edita qualquer memória dos projetos marcados." },
  { id: "global", label: "Global", hint: "Lê e edita tudo, em todos os projetos." },
] as const;

export function relativeTime(ts: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - ts);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

export const statusOf = (a: Pick<AgentRow, "disabled" | "last_used_at">) =>
  a.disabled ? "Revogado" : a.last_used_at == null ? "Sem uso" : "Ativo";

export type PermRow = { project: string; read: string; edit: string };

// Regras do ADR-0003 (Papéis).
export function permissions(role: string, projects: string[], all: Pick<Project, "name">[]): PermRow[] {
  if (role === "global") {
    return [...all.map((p) => p.name).filter((n) => n !== SHARED), SHARED]
      .map((project) => ({ project, read: "tudo", edit: "tudo" }));
  }
  const own = role === "project_admin" ? "tudo do projeto" : "as próprias";
  return [
    ...projects.map((project) => ({ project, read: "tudo", edit: own })),
    { project: SHARED, read: "tudo", edit: "as próprias" },
  ];
}

// Rótulos legíveis para ids internos; id desconhecido aparece cru.
const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLES.map((r) => [r.id, r.label]));
const TOOL_LABEL: Record<string, string> = {
  memory_whoami: "Consultou acesso", memory_remember: "Gravou memória", memory_query: "Buscou",
  memory_multi_hop: "Buscou (multi-hop)", memory_adaptive_query: "Buscou (adaptativa)",
  memory_update: "Editou memória", memory_delete: "Apagou memória", memory_entity_graph: "Grafo de entidade",
  memory_timeline: "Linha do tempo", memory_sql: "Consulta SQL", memory_compact: "Compactou",
  "admin.memory.update": "Painel: editou memória", "admin.memory.delete": "Painel: apagou memória",
  "admin.agent.create": "Painel: criou agente", "admin.agent.update": "Painel: editou agente",
  "admin.agent.token": "Painel: novo token", "admin.agent.delete": "Painel: excluiu agente",
};
const OUTCOME_LABEL: Record<string, string> = {
  ok: "OK", error: "Erro", forbidden: "Sem permissão", invalid: "Inválido", not_found: "Não encontrado", unauthorized: "Não autenticado",
};
const TYPE_LABEL: Record<string, string> = {
  general: "Geral", episodic: "Episódica", profile: "Perfil", working: "Trabalho", skill: "Habilidade",
};
const lookup = (map: Record<string, string>) => (id: string) => map[id] ?? id;
export const roleLabel = lookup(ROLE_LABEL);
export const toolLabel = lookup(TOOL_LABEL);
export const outcomeLabel = lookup(OUTCOME_LABEL);
export const typeLabel = lookup(TYPE_LABEL);

// Cabeçalho do grupo do dia na Atividade: "Hoje", "Ontem" ou "16 de nov." (fuso local).
export function dayLabel(ts: number, now = Date.now() / 1000): string {
  const day = (t: number) => { const d = new Date(t * 1000); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const diff = Math.round((day(now) - day(ts)) / 86_400_000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return new Date(ts * 1000).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

export const latency = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);
