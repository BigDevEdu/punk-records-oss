import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "@astryxdesign/core/AppShell";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { HStack } from "@astryxdesign/core/HStack";
import { Center } from "@astryxdesign/core/Center";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Activity as ActivityIcon, Bot, Brain, Circle, LogOut, Palette, Settings2 } from "lucide-react";
import { usePrefs } from "./prefs";
import { ApiError, ActivityRow, AgentRow, Me, Project, post, projectColor, request, setOnUnauthorized } from "./api";

// Astryx renderiza links com este componente: navega pelo react-router (respeita o basename /admin)
export function RouterLink({ href, ...p }: React.ComponentProps<"a"> & { href: string }) {
  return <Link to={href} {...p} />;
}

// cor do projeto é dado do usuário (escolhida na Projetos), não do tema: vai inline
export function ProjectDot({ color }: { color: string }) {
  return <Icon icon={Circle} size="xsm" style={{ color, fill: color }} />;
}

function LogoMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    // mesmo desenho de public/favicon.svg: a marca é fixa, não segue o tema
    <svg viewBox="0 0 32 32" {...props}>
      <rect x=".75" y=".75" width="30.5" height="30.5" rx="7.25" fill="#18181b" stroke="#ffffff" strokeOpacity=".14" strokeWidth="1.5" />
      <path d="M9.5 11 22.5 9M9.5 11l6.5 12.5M22.5 9 16 23.5" stroke="#ffffff" strokeOpacity=".45" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="9.5" cy="11" r="4.2" fill={projectColor(0)} />
      <circle cx="22.5" cy="9" r="4.2" fill={projectColor(1)} />
      <circle cx="16" cy="23.5" r="4.2" fill={projectColor(2)} />
    </svg>
  );
}
export const Logo = ({ size = "md" }: { size?: "md" | "lg" }) => <Icon icon={LogoMark} size={size} />;

export const apiError = (e: unknown) => (e instanceof ApiError ? e.detail : "Não foi possível falar com o servidor.");

export type LayoutCtx = { agents: AgentRow[]; projects: Project[]; me: Me; reload: () => void; colorOf: (project: string) => string };
type Data = { me: Me; projects: Project[]; agents: AgentRow[]; today: number };

const fmt = new Intl.NumberFormat("pt-BR");
const startOfDay = () => new Date().setHours(0, 0, 0, 0) / 1000;
const count = (n: string) => <Text type="supporting" color="secondary" hasTabularNumbers>{n}</Text>;

export default function Layout() {
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const filtered = pathname === "/" ? new URLSearchParams(search).get("projeto") : null;
  const prefs = usePrefs();
  const [data, setData] = useState<Data | null>(null);
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
      setError(apiError(e));
    });
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => nav("/login", { replace: true }));
    load();
  }, [nav, attempt, load]);

  // cor do projeto: a escolhida em Projetos ou a da paleta pela ordem do servidor
  const colorOf = useMemo(() => {
    const idx = new Map((data?.projects ?? []).map((p) => [p.name, p.color_index]));
    return (name: string) => prefs.colors[name] ?? projectColor(idx.get(name) ?? 0);
  }, [data, prefs.colors]);

  if (error) {
    return (
      <Center height="100dvh">
        <EmptyState title="Painel indisponível" description={error}
          actions={<Button label="Tentar de novo" onClick={() => setAttempt(attempt + 1)} />} />
      </Center>
    );
  }
  if (!data) return <Center height="100dvh"><Spinner label="Carregando" /></Center>;

  const total = data.projects.reduce((s, p) => s + p.count, 0);
  async function logout() {
    await post("/logout").catch(() => {});
    nav("/login", { replace: true });
  }

  const sideNav = (
    <SideNav
      header={<SideNavHeading heading="Punk-Records" icon={<Logo />} headingHref="/" />}
      footer={
        <HStack gap={1} vAlign="center" hAlign="between">
          <Text type="supporting" color="secondary" maxLines={1}>{data.me.agent_id}</Text>
          <HStack gap={0.5}>
            <IconButton label="Aparência" tooltip="Aparência" variant="ghost" size="sm" href="/aparencia" as={RouterLink}
              icon={<Icon icon={Palette} size="sm" />} />
            <IconButton label="Sair" tooltip="Sair" variant="ghost" size="sm" onClick={logout}
              icon={<Icon icon={LogOut} size="sm" />} />
          </HStack>
        </HStack>
      }>
      <SideNavSection title="Principal" isHeaderHidden>
        <SideNavItem label="Cérebro" icon={Brain} href="/" isSelected={pathname === "/" && !filtered} endContent={count(fmt.format(total))} />
        <SideNavItem label="Agentes" icon={Bot} href="/agentes" isSelected={pathname === "/agentes"} endContent={count(fmt.format(data.agents.length))} />
        <SideNavItem label="Atividade" icon={ActivityIcon} href="/atividade" isSelected={pathname === "/atividade"}
          endContent={count(`${fmt.format(data.today)} hoje`)} />
      </SideNavSection>
      {/* cada projeto filtra o Cérebro; a gestão é a ação do título da seção */}
      <SideNavSection title="Projetos"
        endContent={<IconButton label="Gerenciar projetos" tooltip="Gerenciar projetos" variant="ghost" size="sm"
          href="/projetos" as={RouterLink} icon={<Icon icon={Settings2} size="sm" />} />}>
        {data.projects.map((p) => (
          <SideNavItem key={p.name} label={p.name} icon={<ProjectDot color={colorOf(p.name)} />}
            href={filtered === p.name ? "/" : `/?projeto=${encodeURIComponent(p.name)}`}
            isSelected={filtered === p.name} endContent={count(fmt.format(p.count))} />
        ))}
      </SideNavSection>
    </SideNav>
  );

  return (
    <AppShell sideNav={sideNav} variant="wash"
      banner={notice && (
        <Banner status="warning" title={notice} container="section"
          endContent={<Button label="Tentar de novo" size="sm" variant="ghost" onClick={() => void load()} />} />
      )}>
      <Outlet context={{ agents: data.agents, projects: data.projects, me: data.me, reload: () => void load(), colorOf } satisfies LayoutCtx} />
    </AppShell>
  );
}
