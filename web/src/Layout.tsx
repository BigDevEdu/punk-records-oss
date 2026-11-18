import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { usePrefs } from "./prefs";
import { Activity as ActivityIcon, Bot, Brain, LogOut, Menu, Palette, Settings2 } from "lucide-react";
import { ApiError, ActivityRow, AgentRow, Me, Project, post, projectColor, request, setOnUnauthorized } from "./api";

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="5" cy="6" r="2.2" fill={projectColor(0)} /><circle cx="13" cy="5" r="2.2" fill={projectColor(1)} />
      <circle cx="9" cy="13" r="2.2" fill={projectColor(2)} />
      <path d="M5 6L13 5M5 6L9 13M13 5L9 13" style={{ stroke: "var(--text-muted)" }} strokeWidth=".8" />
    </svg>
  );
}

export type LayoutCtx = { agents: AgentRow[]; projects: Project[]; me: Me; reload: () => void; colorOf: (project: string) => string };
type Data = { me: Me; projects: Project[]; agents: AgentRow[]; today: number };

const fmt = new Intl.NumberFormat("pt-BR");
const startOfDay = () => new Date().setHours(0, 0, 0, 0) / 1000;

export default function Layout() {
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const filtered = pathname === "/" ? new URLSearchParams(search).get("projeto") : null;
  const prefs = usePrefs();
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const loaded = useRef(false);

  const load = useCallback(() => {
    setError(""); setNotice("");
    return Promise.all([
      request<Me>("/me"),
      request<Project[]>("/projects"),
      request<AgentRow[]>("/agents"),
      request<ActivityRow[]>("/activity?limit=500"),
    ]).then(([me, projects, agents, act]) => {
      const t = startOfDay();
      loaded.current = true;
      setData({ me, projects, agents, today: act.filter((a) => a.ts >= t).length });
    }).catch((e) => {
      if (e instanceof ApiError && e.status === 401) return; // já redirecionou
      // recarga falha com a tela montada: mantém a UI (pode haver token na tela)
      if (loaded.current) { setNotice("Não foi possível atualizar os contadores."); return; }
      setError(e instanceof ApiError ? e.detail : "Não foi possível falar com o servidor.");
    });
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => nav("/login", { replace: true }));
    load();
  }, [nav, attempt, load]);

  // cor do projeto: a escolhida na Aparência ou a da paleta pela ordem do servidor
  const colorOf = useMemo(() => {
    const idx = new Map((data?.projects ?? []).map((p) => [p.name, p.color_index]));
    return (name: string) => prefs.colors[name] ?? projectColor(idx.get(name) ?? 0);
  }, [data, prefs.colors]);

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
  const link = (to: string, icon: JSX.Element, label: string, count: string, end = false) => (
    <NavLink to={to} end={end} onClick={close} className={({ isActive }) => (isActive ? "on" : "")}>
      <span className="nav-label">{icon}{label}</span>{count && <span className="count">{count}</span>}
    </NavLink>
  );

  async function logout() {
    await post("/logout").catch(() => {});
    nav("/login", { replace: true });
  }

  return (
    <div className="shell">
      <button className="menu-btn plain" aria-controls="menu-principal" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Menu size={16} aria-hidden />Menu
      </button>
      <nav id="menu-principal" className={"side" + (open ? " open" : "")} aria-label="Principal">
        <div className="brand"><Logo />Punk-Records</div>
        {/* 1. destinos: as três telas de trabalho */}
        <div className="side-group">
          {link("/", <Brain size={16} aria-hidden />, "Cérebro", fmt.format(total), true)}
          {link("/agentes", <Bot size={16} aria-hidden />, "Agentes", fmt.format(data.agents.length))}
          {link("/atividade", <ActivityIcon size={16} aria-hidden />, "Atividade", `${fmt.format(data.today)} hoje`)}
        </div>
        {/* 2. projetos: cada um filtra o Cérebro; a gestão é a ação do título da seção */}
        <div className="side-group">
          <div className="side-head">
            <h4 id="proj-head">Projetos</h4>
            <Link to="/projetos" onClick={close} className={"head-action" + (pathname === "/projetos" ? " on" : "")}
              aria-label="Gerenciar projetos" data-tip-left="Gerenciar projetos"><Settings2 size={14} aria-hidden /></Link>
          </div>
          <ul className="proj-list" aria-labelledby="proj-head">
            {data.projects.map((p) => (
              <li key={p.name}>
                <Link to={filtered === p.name ? "/" : `/?projeto=${encodeURIComponent(p.name)}`} onClick={close}
                  className={filtered === p.name ? "on" : ""} aria-current={filtered === p.name ? "true" : undefined}>
                  <span className="nav-label"><span className="dot-slot"><span className="sq" style={{ background: colorOf(p.name) }} /></span>{p.name}</span>
                  <span className="count">{fmt.format(p.count)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        {/* 3. conta e preferências pessoais, no rodapé */}
        <div className="side-foot">
          <span className="who"><span className="avatar" aria-hidden>{data.me.agent_id.slice(0, 1).toUpperCase()}</span>{data.me.agent_id}</span>
          <NavLink to="/aparencia" onClick={close} className={({ isActive }) => "plain icon" + (isActive ? " on" : "")}
            aria-label="Aparência" data-tip="Aparência"><Palette size={15} aria-hidden /></NavLink>
          <button className="plain icon" onClick={logout} aria-label="Sair" data-tip="Sair"><LogOut size={15} aria-hidden /></button>
        </div>
      </nav>
      <main className="main">
        {notice && (
          <div className="notice" role="alert">
            <span>{notice}</span><button className="plain" onClick={() => void load()}>Tentar de novo</button>
          </div>
        )}
        <div key={pathname} className="page page-enter">
          <Outlet context={{ agents: data.agents, projects: data.projects, me: data.me, reload: () => void load(), colorOf } satisfies LayoutCtx} />
        </div>
      </main>
    </div>
  );
}
