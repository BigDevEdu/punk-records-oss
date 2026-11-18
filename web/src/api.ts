export class ApiError extends Error {
  constructor(public code: string, public detail: string, public status = 0) {
    super(detail);
  }
}

let onUnauthorized: () => void = () => location.assign("/admin/login");
export const setOnUnauthorized = (fn: () => void) => { onUnauthorized = fn; };

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const res = await fetch(`/admin/api${path}`, { ...init, headers, credentials: "same-origin" });
  const body = await res.json().catch(() => null);
  if (res.status === 401 && path !== "/login") onUnauthorized(); // login falho mostra o detail
  if (!res.ok) {
    throw new ApiError(body?.error ?? "error", body?.detail ?? `Erro ${res.status}`, res.status);
  }
  return body as T;
}

export const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });

export type Me = { agent_id: string; role: string };
export type Project = { name: string; count: number; color_index: number };
export type GraphNode = {
  id: string; text: string; project: string; agent_id: string; memory_type: string;
  created_at: number; updated_at: number; degree: number;
};
export type GraphEdge = { source: string; target: string; sim: number };
export type Cluster = { id: string; label: string; node_ids: string[] };
export type GraphResponse = { nodes: GraphNode[]; edges: GraphEdge[]; clusters: Cluster[]; total: number };
export type Similar = { id: string; sim: number; text: string; project?: string };
export type MemoryDetail = {
  id: string; text: string; score?: number; project: string; agent_id: string;
  memory_type: string; created_at: number; updated_at: number;
  metadata?: Record<string, unknown>; similar: Similar[];
};
export type SearchHit = { id: string; score: number };
export type AgentRow = {
  id: string; role: string; projects: string[]; disabled: boolean;
  last_used_at: number | null; memory_count: number;
};
export type ActivityRow = {
  ts: number; agent_id: string; role: string; tool: string; projects: string[];
  ids: string[]; n_results: number | null; latency_ms: number; outcome: string;
};

// §9: paleta categórica dos projetos
export const PALETTE = ["#74b9ff", "#61c985", "#e3b866", "#d98ac9", "#d6adf2", "#6bc7d9", "#f0a06a", "#ff6069"];
export const projectColor = (i: number) => PALETTE[i % PALETTE.length];
// cores que o usuário pode escolher na Aparência: paleta de apoio + estados do Grafite
export const SWATCHES = [...PALETTE, "#42a0ff", "#8b6cf0", "#31cf76", "#facc15", "#ff9412", "#ff1e5e", "#979797"];
export const SWATCH_NAMES = ["Azul", "Verde", "Dourado", "Rosa", "Lavanda", "Turquesa", "Laranja", "Vermelho",
  "Azul vivo", "Roxo", "Verde vivo", "Amarelo", "Laranja vivo", "Magenta", "Cinza"];
