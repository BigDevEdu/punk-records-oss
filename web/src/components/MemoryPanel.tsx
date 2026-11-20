import { useEffect, useState } from "react";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
import { TextArea } from "@astryxdesign/core/TextArea";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Eye, Pencil, Trash2, X } from "lucide-react";
import { MemoryDetail, request } from "../api";
import { typeLabel } from "../agents";
import { ProjectDot, apiError } from "../Layout";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const fmtDate = (ts: number) => {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${p(d.getHours())}:${p(d.getMinutes())}`;
};

type Props = {
  id: string; as: string | null; color: (project: string) => string;
  onClose: () => void; onSelect: (id: string) => void; onChanged: () => void;
};

export default function MemoryPanel({ id, as, color, onClose, onSelect, onChanged }: Props) {
  const [m, setM] = useState<MemoryDetail | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => setError(apiError(e));

  useEffect(() => {
    let live = true;
    setM(null); setError(""); setMode("view");
    request<MemoryDetail>(`/memories/${encodeURIComponent(id)}` + (as ? `?as=${encodeURIComponent(as)}` : ""))
      .then((r) => live && setM(r)).catch((e) => live && fail(e));
    return () => { live = false; };
  }, [id, as, attempt]);

  async function save() {
    setBusy(true); setError("");
    try {
      await request(`/memories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ text: draft }) });
      onChanged(); setAttempt(attempt + 1);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError("");
    try {
      await request(`/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
      onChanged(); onClose();
    } catch (e) { fail(e); setBusy(false); setMode("view"); }
  }

  return (
    <VStack gap={5}>
      <HStack gap={2} vAlign="center" hAlign="between">
        <Text type="label" color="secondary">Memória</Text>
        <IconButton label="Fechar detalhe" variant="ghost" size="sm" icon={<Icon icon={X} size="sm" />} onClick={onClose} />
      </HStack>
      {as && <Banner status="info" icon={<Icon icon={Eye} size="sm" />} title={`Vendo como ${as}`} />}
      {error && (
        <Banner status="error" title={error}
          endContent={!m && <Button label="Tentar de novo" size="sm" variant="ghost" onClick={() => setAttempt(attempt + 1)} />} />
      )}
      {!m && !error && <Spinner label="Carregando" />}
      {m && (
        <>
          {mode === "edit" ? (
            <VStack gap={2}>
              <TextArea label="Texto da memória" rows={7} hasAutoFocus value={draft} onChange={setDraft}
                onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); }} />
              <HStack gap={2}>
                <Button label="Salvar" variant="primary" isLoading={busy} isDisabled={!draft.trim()} onClick={save} />
                <Button label="Cancelar" isDisabled={busy} onClick={() => setMode("view")} />
              </HStack>
            </VStack>
          ) : (
            <Text type="large" textWrap="pretty">{m.text}</Text>
          )}
          <MetadataList>
            <MetadataListItem label="Projeto">
              <HStack gap={1} vAlign="center"><ProjectDot color={color(m.project)} /><Text>{m.project}</Text></HStack>
            </MetadataListItem>
            <MetadataListItem label="Autor">{m.agent_id}</MetadataListItem>
            <MetadataListItem label="Tipo">{typeLabel(m.memory_type)}</MetadataListItem>
            <MetadataListItem label="Criada">{fmtDate(m.created_at)}</MetadataListItem>
            <MetadataListItem label="Editada">{fmtDate(m.updated_at)}</MetadataListItem>
          </MetadataList>
          {m.similar.length > 0 && (
            <List hasDividers edge="flush" density="compact" header={<Text type="label" color="secondary">Memórias parecidas</Text>}>
              {m.similar.map((s) => (
                <ListItem key={s.id} onClick={() => onSelect(s.id)} label={<Text maxLines={2}>{s.text}</Text>}
                  startContent={<Text color="secondary" hasTabularNumbers>{Math.round(s.sim * 100)}%</Text>} />
              ))}
            </List>
          )}
          {!as && mode !== "edit" && (
            <HStack gap={2}>
              <Button label="Editar" icon={<Icon icon={Pencil} size="sm" />} onClick={() => { setDraft(m.text); setMode("edit"); }} />
              <Button label="Apagar" variant="destructive" icon={<Icon icon={Trash2} size="sm" />} onClick={() => setMode("confirm")} />
            </HStack>
          )}
          <AlertDialog isOpen={mode === "confirm"} onOpenChange={(o) => !o && setMode("view")}
            title="Apagar memória" description="Apagar esta memória? Não dá para desfazer."
            actionLabel="Apagar" cancelLabel="Cancelar" isActionLoading={busy} onAction={remove} />
        </>
      )}
    </VStack>
  );
}
