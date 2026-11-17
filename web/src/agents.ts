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
