// Backend falso para `npm run dev:mock`: serve /admin/api em memória, sem o servidor Python.
// ponytail: estado some ao reiniciar o vite; busca e similares são ingênuos (substring / mesmo projeto).
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

const now = () => Math.floor(Date.now() / 1000);
const t0 = now();
let PROJECTS = ["punk-records", "site", "infra", "_shared"];
const TYPES = ["general", "episodic", "profile", "working", "skill"];
const TEXTS = [
  "O EpochDB roda num processo único dono do storage",
  "Tokens de agente são guardados só como hash",
  "O painel React é servido em /admin pelo mesmo processo",
  "Caddy faz TLS na frente do servidor MCP",
  "Deploy de produção usa docker compose com volume nomeado",
  "Agente com papel project_admin edita qualquer memória do projeto",
  "Rodar pytest antes de abrir PR",
  "A busca semântica usa k=10 por padrão",
  "Imagem publicada no Docker Hub a cada tag",
  "Landing nova segue o design system Grafite",
  "Memórias em _shared são lidas por todos os agentes",
  "Logs de auditoria guardam latência e resultado de cada chamada",
];

let seq = 0;
const memories = Array.from({ length: 36 }, (_, i) => ({
  id: `m${++seq}`,
  text: `${TEXTS[i % TEXTS.length]}${i >= TEXTS.length ? ` (${Math.floor(i / TEXTS.length) + 1})` : ""}`,
  project: PROJECTS[i % PROJECTS.length],
  agent_id: ["claude-code", "cursor", "ci-bot"][i % 3],
  memory_type: TYPES[i % TYPES.length],
  created_at: t0 - i * 5400,
  updated_at: t0 - i * 3600,
  metadata: { source: "mock" },
}));

const agents = [
  { id: "admin", role: "global", projects: [] as string[], disabled: false, last_used_at: t0 - 30 },
  { id: "claude-code", role: "project_admin", projects: ["punk-records", "infra"], disabled: false, last_used_at: t0 - 600 },
  { id: "cursor", role: "agent", projects: ["site"], disabled: false, last_used_at: t0 - 86400 * 3 },
  { id: "ci-bot", role: "agent", projects: ["infra"], disabled: true, last_used_at: t0 - 86400 * 20 },
  { id: "novo-agente", role: "agent", projects: ["site"], disabled: false, last_used_at: null as number | null },
  ...["codex", "gemini-cli", "aider", "windsurf", "copilot", "n8n-bot"].map((id, i) => (
    { id, role: "agent", projects: [PROJECTS[i % 3]], disabled: false, last_used_at: t0 - 3600 * (i + 2) as number | null })),
];

const TOOLS = ["memory_query", "memory_remember", "admin.memory.update", "memory_delete"];
const backupCfg = {
  client_id: "", client_secret: "", connected: false, folder_id: "", folder_url: null as string | null,
  interval_hours: 24, keep: 7, last_run: null as number | null, last_error: null as string | null,
  redirect_uri: "http://localhost:5173/admin/api/backup/google/callback",
};
const backupFiles = Array.from({ length: 3 }, (_, i) => ({
  id: `b${3 - i}`, name: `punk-records-2026112${1 - i}-030000.tar.gz`, size: String(1_700_000 - i * 50_000),
  createdTime: new Date((t0 - 86400 * i) * 1000).toISOString(),
}));

const activity = Array.from({ length: 60 }, (_, i) => {
  const a = agents[1 + (i % 3)];
  return {
    ts: t0 - i * 900, agent_id: a.id, role: a.role, tool: TOOLS[i % TOOLS.length],
    projects: a.projects.slice(0, 1), ids: [`m${(i % 36) + 1}`], n_results: i % 4 === 0 ? 3 : null,
    latency_ms: 20 + ((i * 37) % 300), outcome: i % 11 === 5 ? "error" : "ok",
  };
});

const token = () => "pr_mock_" + Math.random().toString(36).slice(2, 14);
const visible = (as: string | null) => {
  const a = as ? agents.find((x) => x.id === as) : null;
  if (!a || a.role === "global") return null;
  return a.disabled ? new Set<string>() : new Set([...a.projects, "_shared"]);
};
const see = (as: string | null) => {
  const v = visible(as);
  return memories.filter((m) => !v || v.has(m.project));
};

function graph(as: string | null, minSim: number, only: string | null) {
  const nodes = see(as).filter((n) => !only || n.project === only);
  const edges: { source: string; target: string; sim: number }[] = [];
  nodes.forEach((a, i) => nodes.slice(i + 1).forEach((b, j) => {
    const sim = (a.project === b.project ? 0.75 : 0.5) + ((i * 7 + j * 3) % 20) / 100;
    if (sim >= minSim && (a.project === b.project || (i + j) % 9 === 0)) edges.push({ source: a.id, target: b.id, sim: +sim.toFixed(2) });
  }));
  const degree = (id: string) => edges.filter((e) => e.source === id || e.target === id).length;
  const clusters = PROJECTS.map((p) => ({ id: p, label: p, node_ids: nodes.filter((n) => n.project === p).map((n) => n.id) }))
    .filter((c) => c.node_ids.length);
  return { nodes: nodes.map(({ metadata, ...n }) => ({ ...n, degree: degree(n.id) })), edges, clusters, total: memories.length };
}

async function body(req: IncomingMessage) {
  let s = "";
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

type Res = [number, unknown];
const err = (status: number, error: string, detail: string): Res => [status, { error, detail }];

async function handle(req: IncomingMessage): Promise<Res> {
  const url = new URL(req.url!, "http://x");
  const path = url.pathname.replace(/^\/admin\/api/, "");
  const q = url.searchParams;
  const as = q.get("as");
  const m = req.method;
  let r: RegExpMatchArray | null;

  if (path === "/login" && m === "POST") return [200, { agent_id: "admin", role: "global" }];
  if (path === "/logout" && m === "POST") return [200, { ok: true }];
  if (path === "/me") return [200, { agent_id: "admin", role: "global" }];
  if (path === "/projects")
    return [200, PROJECTS.map((name, color_index) => ({ name, color_index, count: memories.filter((x) => x.project === name).length }))];
  if ((r = path.match(/^\/projects\/([^/]+)$/)) && m === "DELETE") {
    const name = decodeURIComponent(r[1]);
    const dst = (await body(req)).move_to;
    if (name === "_shared") return err(400, "invalid", "o projeto _shared não pode ser excluído");
    if (!PROJECTS.includes(name)) return err(404, "not_found", `projeto inexistente: ${name}`);
    if (typeof dst !== "string" || dst === name || !PROJECTS.includes(dst)) return err(400, "invalid", "move_to deve ser outro projeto");
    let moved = 0;
    for (const x of memories) if (x.project === name) { x.project = dst; moved++; }
    const changed: string[] = [];
    for (const a of agents) if (a.projects.includes(name)) {
      a.projects = [...new Set(a.projects.map((p) => (p === name ? dst : p)))].filter((p) => p !== "_shared");
      changed.push(a.id);
    }
    PROJECTS = PROJECTS.filter((p) => p !== name);
    return [200, { project: name, move_to: dst, moved, agents: changed }];
  }
  if (path === "/graph") return [200, graph(as, Number(q.get("min_sim") ?? 0.55), q.get("projects"))];
  if (path === "/search") {
    const term = (q.get("q") ?? "").toLowerCase();
    if (!term.trim()) return err(400, "invalid", "q vazio");
    return [200, see(as).filter((x) => x.text.toLowerCase().includes(term)).map((x) => ({ id: x.id, score: 0.9 }))];
  }
  if ((r = path.match(/^\/memories\/([^/]+)$/))) {
    const id = decodeURIComponent(r[1]);
    const mem = see(m === "GET" ? as : null).find((x) => x.id === id);
    if (!mem) return err(404, "not_found", id);
    if (m === "GET") {
      const similar = see(as).filter((x) => x.project === mem.project && x.id !== id).slice(0, 4)
        .map((x, i) => ({ id: x.id, sim: +(0.9 - i * 0.05).toFixed(2), text: x.text, project: x.project }));
      return [200, { ...mem, similar }];
    }
    if (m === "PATCH") { Object.assign(mem, { text: (await body(req)).text, updated_at: now() }); return [200, { id }]; }
    if (m === "DELETE") { memories.splice(memories.indexOf(mem), 1); return [200, { id, deleted: true }]; }
  }
  if (path === "/agents" && m === "GET")
    return [200, agents.map((a) => ({ ...a, memory_count: memories.filter((x) => x.agent_id === a.id).length }))];
  if (path === "/agents" && m === "POST") {
    const b = await body(req);
    if (agents.some((a) => a.id === b.id)) return err(409, "conflict", `agente ${b.id} já existe`);
    agents.push({ id: b.id, role: b.role, projects: b.projects ?? [], disabled: false, last_used_at: null });
    return [200, { token: token() }];
  }
  if ((r = path.match(/^\/agents\/([^/]+)(\/token)?$/))) {
    const id = decodeURIComponent(r[1]);
    const a = agents.find((x) => x.id === id);
    if (!a) return err(404, "not_found", id);
    if (r[2] && m === "POST") return [200, { token: token() }];
    if (m === "PATCH") { Object.assign(a, await body(req)); return [200, { id }]; }
    if (m === "DELETE") { agents.splice(agents.indexOf(a), 1); return [200, { id, deleted: true }]; }
  }
  if (path === "/activity") {
    const ag = q.get("agent");
    return [200, activity.filter((x) => !ag || x.agent_id === ag).slice(0, Number(q.get("limit") ?? 200))];
  }
  // backup no Google Drive: tudo simulado em memória; "Conectar" volta direto com ?google=ok
  const pub = () => { const { client_secret, ...rest } = backupCfg; return { ...rest, has_secret: !!client_secret }; };
  if (path === "/backup" && m === "GET") return [200, pub()];
  if (path === "/backup" && m === "PUT") {
    const b = await body(req);
    if (b.client_id) backupCfg.client_id = b.client_id;
    if (b.client_secret) backupCfg.client_secret = b.client_secret;
    if (b.interval_hours !== undefined) backupCfg.interval_hours = b.interval_hours;
    if (b.keep !== undefined) backupCfg.keep = b.keep;
    return [200, pub()];
  }
  if (path === "/backup/google/connect" && m === "POST") {
    if (!backupCfg.client_id || !backupCfg.client_secret) return err(400, "invalid", "informe e salve o Client ID e o Client Secret antes de conectar");
    Object.assign(backupCfg, { connected: true, folder_id: "mock-folder", folder_url: "https://drive.google.com/drive/folders/mock-folder" });
    return [200, { url: "/admin/backup?google=ok" }];
  }
  if (path === "/backup/google" && m === "DELETE") { backupCfg.connected = false; return [200, pub()]; }
  if (path === "/backup/files") return [200, backupCfg.connected ? backupFiles : []];
  if (path === "/backup/run" && m === "POST") {
    const d = new Date();
    const f = { id: `b${backupFiles.length + 1}`, name: `punk-records-${d.toISOString().slice(0, 19).replace(/[-:T]/g, "")}.tar.gz`,
      size: "1843200", createdTime: d.toISOString() };
    backupFiles.unshift(f);
    backupFiles.splice(backupCfg.keep);
    Object.assign(backupCfg, { last_run: now(), last_error: null });
    return [200, f];
  }
  if (path === "/backup/restore" && m === "POST") return [200, { file_id: (await body(req)).file_id, restored: true }];
  return err(404, "not_found", path);
}

export const mockApi = (): Plugin => ({
  name: "punk-records-mock-api",
  configureServer(server) {
    server.middlewares.use("/admin/api", async (req, res: ServerResponse) => {
      req.url = "/admin/api" + req.url; // connect remove o prefixo montado
      const [status, data] = await handle(req).catch((e) => err(500, "error", String(e)));
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    });
  },
});
