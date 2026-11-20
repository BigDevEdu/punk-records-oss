import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Center } from "@astryxdesign/core/Center";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Token } from "@astryxdesign/core/Token";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Banner } from "@astryxdesign/core/Banner";
import { Slider } from "@astryxdesign/core/Slider";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { List, ListItem } from "@astryxdesign/core/List";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Box, List as ListIcon, Network, RefreshCw } from "lucide-react";
import { GraphResponse, SearchHit, request } from "../api";
import { ProjectDot, apiError, type LayoutCtx } from "../Layout";
import { Appear, Page } from "../Page";
import Graph from "../components/Graph";
// three.js só é baixado quando alguém abre a vista 3D
const Graph3D = lazy(() => import("../components/Graph3D"));
import MemoryPanel from "../components/MemoryPanel";
import { relativeTime } from "../agents";

const fmt = new Intl.NumberFormat("pt-BR");

function useNarrow() {
  const q = "(max-width: 767px)";
  const [n, setN] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setN(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return n;
}

export default function Brain() {
  const { agents, colorOf: color } = useOutletContext<LayoutCtx>();
  const [params, setParams] = useSearchParams();
  const as = params.get("as");
  const projeto = params.get("projeto");
  const narrow = useNarrow();
  // lista também no desktop: acessível por teclado e leitor de tela, ao contrário do canvas do grafo
  const asList = narrow || params.get("view") === "lista";
  const is3d = !narrow && params.get("view") === "3d";
  const searchBox = useRef<HTMLElement>(null);
  const searchSeq = useRef(0);

  const [minSim, setMinSim] = useState(0.55);
  const [debounced, setDebounced] = useState(0.55);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(minSim), 300);
    return () => clearTimeout(t);
  }, [minSim]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 15_000); return () => clearInterval(t); }, []);

  // "Ver como" mudou: recarrega o grafo e limpa seleção e busca
  useEffect(() => { searchSeq.current++; setSelected(null); setHits(null); setQuery(""); setSearchError(""); }, [as]);

  useEffect(() => {
    let live = true;
    setError("");
    setLoading(true);
    request<GraphResponse>(`/graph?min_sim=${debounced}` + (as ? `&as=${encodeURIComponent(as)}` : "")
      + (projeto ? `&projects=${encodeURIComponent(projeto)}` : ""))
      .then((g) => { if (live) { setGraph(g); setLoadedAt(Date.now()); } })
      .catch((e) => live && setError(apiError(e)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [as, projeto, debounced, attempt]);

  function clear() { searchSeq.current++; setQuery(""); setHits(null); setSearchError(""); setSelected(null); }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "Escape") { if (!e.defaultPrevented) clear(); }
      else if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault(); searchBox.current?.querySelector("input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function runSearch() {
    if (!query.trim()) return clear();
    setSearchError("");
    const seq = ++searchSeq.current;
    try {
      const r = await request<SearchHit[]>(`/search?q=${encodeURIComponent(query)}` + (as ? `&as=${encodeURIComponent(as)}` : ""));
      if (seq === searchSeq.current) setHits(r);
    } catch (err) {
      if (seq === searchSeq.current) setSearchError(apiError(err));
    }
  }

  function setParam(k: string, v: string) {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p);
  }

  const highlight = useMemo(() => (hits && hits.length ? new Set(hits.map((h) => h.id)) : null), [hits]);

  let body;
  if (error) {
    body = (
      <Center height="100%" padding={6}>
        <EmptyState title="Não foi possível carregar o grafo" description={error}
          actions={<Button label="Tentar de novo" onClick={() => setAttempt(attempt + 1)} />} />
      </Center>
    );
  } else if (!graph) {
    body = <Center height="100%"><Spinner label="Carregando" /></Center>;
  } else if (graph.nodes.length === 0) {
    body = (
      <Center height="100%" padding={6}>
        <EmptyState title="Nenhuma memória ainda" description="Quando os agentes gravarem, elas aparecem aqui." />
      </Center>
    );
  } else if (asList) {
    // no celular, com uma memória aberta, o painel ocupa o lugar da lista
    const list = [...graph.nodes].filter((n) => !highlight || highlight.has(n.id)).sort((a, b) => b.updated_at - a.updated_at);
    body = selected && narrow ? null : (
      <VStack padding={3}><List hasDividers header={<Text type="label" color="secondary">Memórias</Text>}>
        {list.map((n) => (
          <ListItem key={n.id} isSelected={n.id === selected} onClick={() => setSelected(n.id)}
            label={<Text maxLines={2}>{n.text}</Text>}
            description={
              <HStack gap={1} vAlign="center">
                <ProjectDot color={color(n.project)} /><Text type="supporting" color="secondary">{n.project} · {relativeTime(n.updated_at)}</Text>
              </HStack>
            } />
        ))}
      </List></VStack>
    );
  } else {
    const props = { nodes: graph.nodes, edges: graph.edges, clusters: graph.clusters, color, highlight, selected, onSelect: setSelected };
    body = is3d ? (
      <Suspense fallback={<Center height="100%"><Spinner label="Carregando o 3D" /></Center>}>
        <Graph3D {...props} />
      </Suspense>
    ) : <Graph {...props} />;
  }

  const title = (
    <>
      <Text as="h1" type="large" weight="semibold">Cérebro</Text>
      {projeto
        ? <Token label={projeto} icon={<ProjectDot color={color(projeto)} />} onRemove={() => setParam("projeto", "")}
            description="Remover o filtro e mostrar todos os projetos" />
        : <Text color="secondary">Todos os projetos</Text>}
      {as && <Token label={`Como ${as}`} onRemove={() => setParam("as", "")} description="Voltar a ver como todos" />}
    </>
  );

  const actions = (
    <>
      <HStack ref={searchBox}>
        <TextInput label="Pesquisar memórias" isLabelHidden type="search" placeholder="Pesquisar memórias (/)" startIcon="search"
          size="sm" value={query} onChange={setQuery} onEnter={() => void runSearch()} enterKeyHint="search" />
      </HStack>
      {!narrow && (
        <SegmentedControl label="Visualização" size="sm" value={asList ? "lista" : is3d ? "3d" : "grafo"} onChange={(v) => setParam("view", v === "grafo" ? "" : v)}>
          <SegmentedControlItem value="grafo" label="Grafo" isLabelHidden icon={<Icon icon={Network} size="sm" />} />
          <SegmentedControlItem value="3d" label="Grafo 3D" isLabelHidden icon={<Icon icon={Box} size="sm" />} />
          <SegmentedControlItem value="lista" label="Lista" isLabelHidden icon={<Icon icon={ListIcon} size="sm" />} />
        </SegmentedControl>
      )}
      <Selector label="Ver como" isLabelHidden size="sm" value={as ?? ""} onChange={(v) => setParam("as", v ?? "")}
        hasSearch={agents.length > 8} searchPlaceholder="Filtrar"
        options={[{ value: "", label: "Ver como: todos" }, ...agents.map((a) => ({ value: a.id, label: a.id }))]} />
    </>
  );

  const stat = (t: string) => <Text type="supporting" color="secondary" hasTabularNumbers>{t}</Text>;
  const footer = (
    <HStack gap={4} vAlign="center" hAlign="between" wrap="wrap">
      <HStack gap={3} vAlign="center">
        {stat(projeto && graph ? `${fmt.format(graph.nodes.length)} de ${fmt.format(graph.total)} memórias` : `${fmt.format(graph?.total ?? 0)} memórias`)}
        {!asList && stat(`${fmt.format(graph?.edges.length ?? 0)} ligações`)}
      </HStack>
      {!asList && (
        <HStack gap={2} vAlign="center">
          <Text type="supporting" color="secondary">Similaridade mínima</Text>
          <Slider label="Similaridade mínima" isLabelHidden width={160} min={0.3} max={0.95} step={0.05} value={minSim}
            onChange={(v: number) => setMinSim(v)} valueDisplay="none" formatValue={(v) => v.toFixed(2).replace(".", ",")} />
          {stat(minSim.toFixed(2).replace(".", ","))}
        </HStack>
      )}
      <HStack gap={1} vAlign="center">
        {stat(loading ? "Atualizando" : `Atualizado ${relativeTime(loadedAt / 1000)}`)}
        <IconButton label="Atualizar" tooltip="Atualizar" variant="ghost" size="sm" icon={<Icon icon={RefreshCw} size="sm" />}
          isLoading={loading} onClick={() => setAttempt((a) => a + 1)} />
      </HStack>
    </HStack>
  );

  return (
    <Page isFlush title={title} actions={actions} footer={footer}
      panel={selected && !error ? (
        <MemoryPanel id={selected} as={as} color={color} onClose={() => setSelected(null)}
          onSelect={setSelected} onChanged={() => setAttempt((a) => a + 1)} />
      ) : undefined}
      panelLabel="Detalhe da memória" panelKey={selected}>
      {searchError && <Appear><Banner status="error" title={searchError} container="section" /></Appear>}
      {hits && hits.length === 0 && <Appear><Banner status="info" title="Nada encontrado para essa busca." container="section" isDismissable dismissLabel="Fechar" onDismiss={clear} /></Appear>}
      {body}
    </Page>
  );
}
