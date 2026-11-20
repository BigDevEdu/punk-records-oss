import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { Table, proportional } from "@astryxdesign/core/Table";
import { Plus } from "lucide-react";
import { AgentRow, post, request } from "../api";
import { ProjectDot, apiError, type LayoutCtx } from "../Layout";
import { Page } from "../Page";
import { relativeTime, roleLabel, statusOf } from "../agents";
import AgentPanel from "../components/AgentPanel";
import CreateAgent from "../components/CreateAgent";
import TokenOnce from "../components/TokenOnce";

type Side =
  | { k: "none" } | { k: "detail" } | { k: "create" } | { k: "edit" }
  | { k: "token"; id: string; token: string; rotated: boolean };
const LOCK_HINT = "Copie o token antes de continuar";
const STATUS_BADGE = { Ativo: "success", Revogado: "neutral", "Sem uso": "warning" } as const;

export default function Agents() {
  const { agents, projects, me, reload, colorOf } = useOutletContext<LayoutCtx>();
  const [sel, setSel] = useState<string | null>(null);
  const [side, setSide] = useState<Side>({ k: "none" });
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const agent = agents.find((a) => a.id === sel) ?? null;
  const rows = agents.filter((a) => a.id.includes(filter.trim().toLowerCase()));

  async function act(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); reload(); }
    catch (e) { setError(apiError(e)); }
    finally { setBusy(false); }
  }
  const locked = side.k === "token";
  const select = (id: string) => { setSel(id); setSide({ k: "detail" }); setError(""); };
  const patch = (id: string, body: object) =>
    request(`/agents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });

  const columns = [
    {
      key: "id", header: "Agente", width: proportional(1),
      renderCell: (a: AgentRow) => (
        <Link isDisabled={locked} tooltip={locked ? LOCK_HINT : undefined} onClick={() => select(a.id)}>
          {a.id === sel ? <Text weight="semibold" color="inherit">{a.id}</Text> : a.id}
        </Link>
      ),
    },
    { key: "role", header: "Papel", width: proportional(1), renderCell: (a: AgentRow) => <Text>{roleLabel(a.role)}</Text> },
    {
      key: "projects", header: "Projetos", width: proportional(1),
      renderCell: (a: AgentRow) => a.role === "global" ? <Text color="secondary">todos</Text>
        : a.projects.length === 0 ? <Text color="secondary">nenhum</Text> : (
          <HStack gap={1} vAlign="center">
            <ProjectDot color={colorOf(a.projects[0])} /><Text>{a.projects[0]}</Text>
            {a.projects.length > 1 && <Text color="secondary">+{a.projects.length - 1}</Text>}
          </HStack>
        ),
    },
    {
      key: "last_used_at", header: "Último uso", width: proportional(1),
      renderCell: (a: AgentRow) => a.last_used_at == null ? <Text color="secondary">nunca</Text> : <Text>{relativeTime(a.last_used_at)}</Text>,
    },
    {
      key: "status", header: "Status", width: proportional(1),
      renderCell: (a: AgentRow) => { const st = statusOf(a); return <Badge variant={STATUS_BADGE[st]} label={st} />; },
    },
  ];

  let panel = null;
  if (side.k === "detail" && agent) {
    panel = (
      <AgentPanel agent={agent} isSelf={agent.id === me.agent_id} projects={projects} busy={busy} error={error}
        onClose={() => setSide({ k: "none" })} onEdit={() => setSide({ k: "edit" })}
        onRotate={() => act(async () => {
          const r = await post<{ token: string }>(`/agents/${encodeURIComponent(agent.id)}/token`);
          setSide({ k: "token", id: agent.id, token: r.token, rotated: true });
        })}
        onDisable={(d) => act(() => patch(agent.id, { disabled: d }).then(() => undefined))}
        onDelete={() => act(async () => {
          await request(`/agents/${encodeURIComponent(agent.id)}`, { method: "DELETE" });
          setSel(null); setSide({ k: "none" });
        })} />
    );
  } else if (side.k === "create") {
    panel = <CreateAgent projects={projects} onCancel={() => setSide({ k: "none" })}
      onCreated={(id, token) => { setSel(id); setSide({ k: "token", id, token, rotated: false }); reload(); }} />;
  } else if (side.k === "edit" && agent) {
    panel = <CreateAgent agent={agent} isSelf={agent.id === me.agent_id} projects={projects}
      onCancel={() => setSide({ k: "detail" })} onSaved={() => { setSide({ k: "detail" }); reload(); }} />;
  } else if (side.k === "token") {
    panel = <TokenOnce id={side.id} token={side.token} rotated={side.rotated} onClose={() => setSide({ k: "detail" })} />;
  }

  return (
    <Page title="Agentes" isFlush panel={panel} panelKey={`${side.k}:${sel}`} panelLabel={agent && side.k === "detail" ? `Agente ${agent.id}` : undefined}
      actions={<>
        <TextInput label="Filtrar agentes" isLabelHidden placeholder="Filtrar agentes" startIcon="search" size="sm"
          value={filter} onChange={setFilter} />
        <Button label="Criar agente" variant="primary" size="sm" icon={<Icon icon={Plus} size="sm" />}
          isDisabled={locked || side.k === "create" || side.k === "edit"} tooltip={locked ? LOCK_HINT : undefined}
          onClick={() => setSide({ k: "create" })} />
      </>}>
      <Table data={rows} columns={columns} idKey="id" hasHover
        emptyState={<EmptyState title="Nenhum agente encontrado." isCompact />} />
      {locked && <VisuallyHidden><Text role="status">{LOCK_HINT}</Text></VisuallyHidden>}
    </Page>
  );
}
