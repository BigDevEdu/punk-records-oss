import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Selector } from "@astryxdesign/core/Selector";
import { List, ListItem } from "@astryxdesign/core/List";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { ArrowRight, RotateCcw, Trash2 } from "lucide-react";
import { SWATCHES, SWATCH_NAMES, projectColor, request } from "../api";
import { SHARED } from "../agents";
import { setPrefs, setProjectColor, usePrefs } from "../prefs";
import { ProjectDot, apiError, type LayoutCtx } from "../Layout";
import { Appear, Page, SettingsBlock } from "../Page";

const fmt = new Intl.NumberFormat("pt-BR");
const plural = (n: number, um: string, varios: string) => `${fmt.format(n)} ${n === 1 ? um : varios}`;

type Result = { project: string; move_to: string; moved: number; agents: string[] };

export default function Projects() {
  const { projects, agents, colorOf, reload } = useOutletContext<LayoutCtx>();
  const prefs = usePrefs();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Result | null>(null);

  function startDelete(name: string) {
    setDeleting(name); setError(""); setDone(null);
    setTarget(projects.find((p) => p.name !== name && p.name !== SHARED)?.name ?? SHARED);
  }

  async function confirmDelete(name: string) {
    setBusy(true); setError("");
    try {
      const r = await request<Result>(`/projects/${encodeURIComponent(name)}`, {
        method: "DELETE", body: JSON.stringify({ move_to: target }),
      });
      // A cor padrão vem da posição na lista: sem projeto no meio, os seguintes mudariam de cor.
      // Fixa a cor atual de quem fica e tira a do projeto excluído.
      setPrefs({ colors: Object.fromEntries(projects.filter((p) => p.name !== name).map((p) => [p.name, colorOf(p.name)])) });
      setDone(r); setDeleting(null);
      reload();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Projetos">
      {done && (
        <Appear><Banner status="success" isDismissable dismissLabel="Fechar" onDismiss={() => setDone(null)}
          title={`Projeto ${done.project} excluído. ${plural(done.moved, "memória movida", "memórias movidas")} para ${done.move_to}`
            + (done.agents.length > 0 ? ` · ${plural(done.agents.length, "agente passou", "agentes passaram")} a ter acesso a ${done.move_to}.` : ".")} /></Appear>
      )}
      <SettingsBlock title="Cor e exclusão" description="A cor vale no grafo, na barra lateral e nas listas, e fica salva neste navegador. Excluir um projeto move as memórias dele para outro; nenhuma memória é apagada.">
        <List hasDividers edge="flush">
          {projects.map((p) => {
            const current = colorOf(p.name);
            const others = projects.filter((o) => o.name !== p.name);
            const gaining = agents.filter((a) => a.projects.includes(p.name));
            return (
              <ListItem key={p.name} align="start" startContent={<ProjectDot color={current} />} label={p.name}
                endContent={p.name === SHARED
                  ? <Text type="supporting" color="secondary">Compartilhado com todos; não pode ser excluído.</Text>
                  : <Button label="Excluir" variant="ghost" size="sm" icon={<Icon icon={Trash2} size="sm" />}
                      isDisabled={deleting === p.name} onClick={() => startDelete(p.name)} />}
                description={
                  <VStack gap={3}>
                    <Text type="supporting" color="secondary">{plural(p.count, "memória", "memórias")}</Text>
                    <HStack gap={0.5} wrap="wrap" role="group" aria-label={`Cor de ${p.name}`}>
                      {SWATCHES.map((c, i) => (
                        <ToggleButton key={c} label={SWATCH_NAMES[i]} isIconOnly size="sm" isPressed={current === c}
                          icon={<ProjectDot color={c} />}
                          onPressedChange={() => setProjectColor(p.name, c === projectColor(p.color_index) ? null : c)} />
                      ))}
                    </HStack>
                    {deleting === p.name && (
                      <Appear><Banner status="warning" title={`Excluir ${p.name}?`} collapsible={false}
                        description={p.count > 0 ? `As ${plural(p.count, "memória", "memórias")} dele vão para:` : "Ele não tem memórias. Agentes com acesso a ele passam para:"}>
                        <VStack gap={3}>
                          <HStack gap={2} vAlign="center" wrap="wrap">
                            <ProjectDot color={current} /><Text>{p.name}</Text>
                            <Icon icon={ArrowRight} size="sm" color="secondary" />
                            <Selector label="Mover para" isLabelHidden value={target} onChange={(v) => setTarget(v ?? "")}
                              options={others.map((o) => ({ value: o.name, label: o.name === SHARED ? "_shared (todos veem)" : o.name }))} />
                          </HStack>
                          {gaining.length > 0 && target !== SHARED && (
                            <Text type="supporting" color="secondary">
                              {gaining.map((a) => a.id).join(", ")} {gaining.length === 1 ? "tinha" : "tinham"} acesso
                              a {p.name} e {gaining.length === 1 ? "passa" : "passam"} a ter acesso a {target}, para continuar vendo essas memórias.
                            </Text>
                          )}
                          {target === SHARED && p.count > 0 && (
                            <Text type="supporting" color="secondary">Em _shared, as memórias ficam visíveis para todos os agentes.</Text>
                          )}
                          {error && <Banner status="error" title={error} />}
                          <HStack gap={2} hAlign="end">
                            <Button label="Cancelar" onClick={() => setDeleting(null)} />
                            <Button label={busy ? "Movendo" : "Mover e excluir"} variant="destructive" isLoading={busy}
                              isDisabled={!target} icon={<Icon icon={Trash2} size="sm" />} onClick={() => confirmDelete(p.name)} />
                          </HStack>
                        </VStack>
                      </Banner></Appear>
                    )}
                  </VStack>
                } />
            );
          })}
        </List>
        <HStack hAlign="end">
          <Button label="Restaurar cores padrão" variant="ghost" icon={<Icon icon={RotateCcw} size="sm" />}
            isDisabled={Object.keys(prefs.colors).length === 0} onClick={() => setPrefs({ colors: {} })} />
        </HStack>
      </SettingsBlock>
    </Page>
  );
}
