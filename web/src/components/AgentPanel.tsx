import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Banner } from "@astryxdesign/core/Banner";
import { Appear } from "../Page";
import { Divider } from "@astryxdesign/core/Divider";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Table } from "@astryxdesign/core/Table";
import { Ban, Eye, KeyRound, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { AgentRow, Project } from "../api";
import { ProjectDot, type LayoutCtx } from "../Layout";
import { SELF_HINT, permissions, relativeTime, roleLabel, type PermRow } from "../agents";

const fmt = new Intl.NumberFormat("pt-BR");
const icon = (c: Parameters<typeof Icon>[0]["icon"]) => <Icon icon={c} size="sm" />;

export default function AgentPanel({ agent, isSelf, projects, busy, error, onEdit, onRotate, onDisable, onDelete, onClose }: {
  agent: AgentRow; isSelf: boolean; projects: Project[]; busy: boolean; error: string;
  onEdit: () => void; onRotate: () => void; onDisable: (disabled: boolean) => void; onDelete: () => void; onClose: () => void;
}) {
  const nav = useNavigate();
  const [confirm, setConfirm] = useState<"" | "revoke" | "delete">("");
  useEffect(() => setConfirm(""), [agent.id]);
  const color = useOutletContext<LayoutCtx>().colorOf;
  const perms: PermRow[] = [
    ...permissions(agent.role, agent.projects, projects),
    ...(agent.role !== "global" ? [{ project: "outros projetos", read: "não", edit: "não" }] : []),
  ];
  const lock = isSelf ? SELF_HINT : undefined;
  const last = agent.last_used_at == null ? "nunca"
    : `${new Date(agent.last_used_at * 1000).toLocaleString("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} (${relativeTime(agent.last_used_at)})`;

  return (
    <VStack gap={5}>
      <HStack gap={2} vAlign="center" hAlign="between">
        <Heading level={2} maxLines={1}>{agent.id}</Heading>
        <IconButton label="Fechar detalhe" variant="ghost" size="sm" icon={icon(X)} onClick={onClose} />
      </HStack>
      <MetadataList>
        <MetadataListItem label="Papel">{roleLabel(agent.role)}</MetadataListItem>
        <MetadataListItem label="Memórias">{fmt.format(agent.memory_count)} gravadas</MetadataListItem>
        <MetadataListItem label="Último uso">{last}</MetadataListItem>
      </MetadataList>
      <VStack gap={2}>
        <Text type="label" color="secondary">O que este agente pode fazer</Text>
        <Table data={perms} idKey="project" density="compact" columns={[
          {
            key: "project", header: "Projeto",
            renderCell: (p: PermRow) => p.project === "outros projetos" ? <Text color="secondary">{p.project}</Text>
              : <HStack gap={1} vAlign="center"><ProjectDot color={color(p.project)} /><Text>{p.project}</Text></HStack>,
          },
          { key: "read", header: "Ler" },
          { key: "edit", header: "Editar" },
        ]} />
      </VStack>
      <VStack gap={1} hAlign="start">
        <Button label="Ver o cérebro como este agente" variant="ghost" icon={icon(Eye)} onClick={() => nav(`/?as=${encodeURIComponent(agent.id)}`)} />
        <Button label="Editar papel e projetos" variant="ghost" icon={icon(Pencil)} onClick={onEdit} />
        <Button label="Gerar novo token" variant="ghost" icon={icon(KeyRound)} isDisabled={isSelf || busy} tooltip={lock} onClick={onRotate} />
        {agent.disabled
          ? <Button label="Reativar" variant="ghost" icon={icon(RotateCcw)} isDisabled={isSelf || busy} tooltip={lock} onClick={() => onDisable(false)} />
          : <Button label="Revogar acesso" variant="ghost" icon={icon(Ban)} isDisabled={isSelf || busy} tooltip={lock} onClick={() => setConfirm("revoke")} />}
      </VStack>
      <Divider />
      <VStack gap={1} hAlign="start">
        <Button label="Excluir agente" variant="destructive" icon={icon(Trash2)} isDisabled={isSelf || busy} tooltip={lock} onClick={() => setConfirm("delete")} />
        <Text type="supporting" color="secondary">Apaga o agente e o token. As memórias dele continuam.</Text>
        {isSelf && <Text type="supporting" color="secondary">{SELF_HINT}</Text>}
      </VStack>
      {error && <Appear><Banner status="error" title={error} /></Appear>}

      <AlertDialog isOpen={confirm === "revoke"} onOpenChange={(o) => !o && setConfirm("")}
        title="Revogar acesso"
        description={`Revogar o acesso de ${agent.id}? As chamadas dele passam a ser recusadas na hora. Dá para reativar depois.`}
        actionLabel="Revogar acesso" cancelLabel="Cancelar" onAction={() => { setConfirm(""); onDisable(true); }} />
      <AlertDialog isOpen={confirm === "delete"} onOpenChange={(o) => !o && setConfirm("")}
        title="Excluir agente" description={`Excluir o agente ${agent.id}? As memórias dele continuam.`}
        actionLabel="Excluir agente" cancelLabel="Cancelar" onAction={() => { setConfirm(""); onDelete(); }} />
    </VStack>
  );
}
