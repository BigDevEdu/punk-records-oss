import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ApiError, ActivityRow, AgentRow, Me, Project, post, projectColor, request, setOnUnauthorized } from "./api";

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="5" cy="6" r="2.2" fill="#5b8def" /><circle cx="13" cy="5" r="2.2" fill="#3fb68b" />
      <circle cx="9" cy="13" r="2.2" fill="#e0a43b" />
      <path d="M5 6L13 5M5 6L9 13M13 5L9 13" stroke="#8f96a3" strokeWidth=".8" />
    </svg>
  );
}

export type LayoutCtx = { agents: AgentRow[]; projects: Project[] };
type Data = { me: Me; projects: Project[]; agents: AgentRow[]; today: number };

const fmt = new Intl.NumberFormat("pt-BR");
const startOfDay = () => new Date().setHours(0, 0, 0, 0) / 1000;

export default function Layout() {
  const nav = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setOnUnauthorized(() => nav("/login", { replace: true }));
    setError("");
    Promise.all([
      request<Me>("/me"),
      request<Project[]>("/projects"),
      request<AgentRow[]>("/agents"),
      request<ActivityRow[]>("/activity?limit=500"),
    ]).then(([me, projects, agents, act]) => {
      const t = startOfDay();
      setData({ me, projects, agents, today: act.filter((a) => a.ts >= t).length });
    }).catch((e) => {
      if (e instanceof ApiError && e.status === 401) return; // já redirecionou
      setError(e instanceof ApiError ? e.detail : "Não foi possível falar com o servidor.");
    });
  }, [nav, attempt]);

  if (error) {
    return (
      <div className="loading">
        <p className="error" role="alert">{error}</p>
        <button className="plain" onClick={() => setAttempt(attempt + 1)}>Tentar de novo</button>
      </div>
    );
  }
  if (!data) return <div className="loading muted">Carregando</div>;

  const total = data.projects.reduce((s, p) => s + p.count, 0);
  const close = () => setOpen(false);
  const link = (to: string, label: string, count: string, end = false) => (
    <NavLink to={to} end={end} onClick={close} className={({ isActive }) => (isActive ? "on" : "")}>
      <span>{label}</span><span className="count">{count}</span>
    </NavLink>
  );

  async function logout() {
    await post("/logout").catch(() => {});
    nav("/login", { replace: true });
  }

  return (
    <div className="shell">
      <button className="menu-btn plain" aria-controls="menu-principal" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Logo />Menu
      </button>
      <nav id="menu-principal" className={"side" + (open ? " open" : "")} aria-label="Principal">
        <div className="brand"><Logo />Punk-Records</div>
        {link("/", "Cérebro", fmt.format(total), true)}
        {link("/agentes", "Agentes", fmt.format(data.agents.length))}
        {link("/atividade", "Atividade", `hoje ${fmt.format(data.today)}`)}
        <h4>Projetos</h4>
        {data.projects.map((p) => (
          <div key={p.name} className="proj">
            <span><span className="sq" style={{ background: projectColor(p.color_index) }} />{p.name}</span>
            <span className="count">{fmt.format(p.count)}</span>
          </div>
        ))}
        <div className="side-foot">
          <span className="muted">{data.me.agent_id}</span>
          <button className="plain" onClick={logout}>Sair</button>
        </div>
      </nav>
      <main className="main"><Outlet context={{ agents: data.agents, projects: data.projects } satisfies LayoutCtx} /></main>
    </div>
  );
}
