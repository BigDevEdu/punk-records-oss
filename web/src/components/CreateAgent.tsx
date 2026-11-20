import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Appear } from "../Page";
import { TextInput } from "@astryxdesign/core/TextInput";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList";
import { Plus } from "lucide-react";
import { AgentRow, Project, post, request } from "../api";
import { ID_RE, ROLES, SELF_HINT, SHARED } from "../agents";
import { ProjectDot, apiError, type LayoutCtx } from "../Layout";

export default function CreateAgent({ agent, isSelf, projects, onCreated, onSaved, onCancel }: {
  agent?: AgentRow; isSelf?: boolean; projects: Project[];
  onCreated?: (id: string, token: string) => void; onSaved?: () => void; onCancel: () => void;
}) {
  const { colorOf } = useOutletContext<LayoutCtx>();
  const edit = !!agent;
  const [id, setId] = useState("");
  const [role, setRole] = useState<string>(agent?.role ?? "agent");
  const [chosen, setChosen] = useState<string[]>(agent?.projects ?? []);
  const [extra, setExtra] = useState<string[]>([]);
  const [newName, setNewName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const known = projects.filter((p) => p.name !== SHARED);
  const names = [...known.map((p) => p.name), ...chosen.filter((c) => !known.some((p) => p.name === c)), ...extra]
    .filter((n, i, a) => a.indexOf(n) === i);
  const roleHint = ROLES.find((r) => r.id === role)!.hint;

  function addProject() {
    const n = (newName ?? "").trim();
    if (!ID_RE.test(n) || n === SHARED) { setError("Nome de projeto inválido: use letras minúsculas, números e hífen."); return; }
    setError("");
    if (!names.includes(n)) setExtra([...extra, n]);
    if (!chosen.includes(n)) setChosen([...chosen, n]);
    setNewName(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pid = edit ? agent!.id : id.trim();
    if (!ID_RE.test(pid)) { setError("Nome inválido: use 2 a 63 letras minúsculas, números ou hífen, começando por letra ou número."); return; }
    setBusy(true); setError("");
    const projs = role === "global" ? [] : chosen;
    try {
      if (edit) {
        await request(`/agents/${encodeURIComponent(pid)}`, { method: "PATCH", body: JSON.stringify({ role, projects: projs }) });
        onSaved?.();
      } else {
        const r = await post<{ token: string }>("/agents", { id: pid, role, projects: projs });
        onCreated?.(pid, r.token);
      }
    } catch (err) {
      setError(apiError(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <VStack gap={5}>
        <Heading level={2}>{edit ? `Editar ${agent!.id}` : "Criar agente"}</Heading>
        <FormLayout>
          <TextInput label="Nome" value={edit ? agent!.id : id} isReadOnly={edit} hasAutoFocus={!edit} autoComplete="off"
            placeholder="ex.: cursor-trabalho" onChange={setId}
            description={edit ? undefined : "Letras minúsculas, números e hífen. Aparece na auditoria."} />
          <RadioList label="Papel" value={role} onChange={setRole} description={roleHint}
            disabledMessage={isSelf ? SELF_HINT : undefined}>
            {ROLES.map((r) => <RadioListItem key={r.id} value={r.id} label={r.label} isDisabled={!!isSelf && r.id !== "global"} />)}
          </RadioList>
          {role !== "global" && (
            <VStack gap={2}>
              <CheckboxList label="Projetos" value={chosen} onChange={setChosen}>
                {names.map((n) => <CheckboxListItem key={n} value={n} label={<HStack gap={1} vAlign="center"><ProjectDot color={colorOf(n)} /><Text>{n}</Text></HStack>} aria-label={n} />)}
              </CheckboxList>
              {newName === null ? (
                <HStack><Button label="Novo projeto" variant="ghost" size="sm" icon={<Icon icon={Plus} size="sm" />} onClick={() => setNewName("")} /></HStack>
              ) : (
                <HStack gap={2} vAlign="end">
                  <TextInput label="Nome do novo projeto" isLabelHidden placeholder="Nome do novo projeto" size="sm" hasAutoFocus
                    value={newName} onChange={setNewName} onEnter={addProject}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
                  <Button label="Adicionar" size="sm" onClick={addProject} />
                </HStack>
              )}
            </VStack>
          )}
        </FormLayout>
        {error && <Appear><Banner status="error" title={error} /></Appear>}
        <HStack gap={2} hAlign="end">
          <Button label="Cancelar" onClick={onCancel} />
          <Button label={edit ? "Salvar alterações" : "Criar agente"} type="submit" variant="primary" isLoading={busy} />
        </HStack>
      </VStack>
    </form>
  );
}
