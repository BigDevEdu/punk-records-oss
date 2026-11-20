import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { ForceGraphMethods } from "react-force-graph-3d";
import { VStack } from "@astryxdesign/core/VStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Maximize, Minus, Plus } from "lucide-react";
import { escapeHtml } from "../escape";
import { Cluster, GraphEdge, GraphNode } from "../api";
import { useTheme } from "../prefs";
import { NO_INK, reduced, token } from "./Graph";

// Mesmo contrato do Graph 2D; carregado sob demanda (three.js é pesado) só quando a vista 3D é escolhida.
type Props = {
  nodes: GraphNode[]; edges: GraphEdge[]; clusters: Cluster[];
  color: (project: string) => string;
  highlight: Set<string> | null; selected: string | null; onSelect: (id: string) => void;
};
type N = GraphNode & { x?: number; y?: number; z?: number };

const FLY = 900;   // ms do voo da câmera
const NEAR = 180;  // distância da câmera ao nó escolhido: perto o bastante para ler os vizinhos

export default function Graph3D({ nodes, edges, color, highlight, selected, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // a biblioteca muta os objetos (x, y, z, source/target): entrega cópias
  const data = useMemo(
    () => ({ nodes: nodes.map((n) => ({ ...n })) as N[], links: edges.map((e) => ({ ...e })) }),
    [nodes, edges],
  );
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);
  const fitted = useRef(false);
  useEffect(() => { fitted.current = false; }, [data]);

  const ms = (t: number) => (reduced() ? 0 : t);
  const fit = () => fg.current?.zoomToFit(ms(600), 60);

  // memória escolhida (no grafo, na lista de parecidas ou na busca): a câmera voa até ela
  useEffect(() => {
    const n = selected ? byId.get(selected) : undefined;
    if (n?.x === undefined) { if (!selected && fitted.current) fit(); return; }
    const d = Math.hypot(n.x, n.y!, n.z!) || 1;
    const k = 1 + NEAR / d;
    fg.current?.cameraPosition({ x: n.x * k, y: n.y! * k, z: n.z! * k }, { x: n.x, y: n.y!, z: n.z! }, ms(FLY));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, size.w, size.h, byId]);

  const theme = useTheme();
  const [ink, setInk] = useState(NO_INK);
  useEffect(() => {
    const el = box.current!;
    setInk({ ...NO_INK, bg: token(el, "--color-background-body"), link: token(el, "--color-border-emphasized") });
  }, [theme]);

  // a busca apaga o que não bateu: em 3D a cor vira a das ligações, já que o nó não tem transparência própria
  const nodeColor = (n: N) => (highlight && !highlight.has(n.id) ? ink.link : color(n.project));

  function zoom(factor: number) {
    const c = fg.current?.camera().position;
    if (c) fg.current?.cameraPosition({ x: c.x * factor, y: c.y * factor, z: c.z * factor }, undefined, ms(300));
  }

  return (
    <div ref={box} className="graph" role="img" aria-label={`Grafo 3D com ${nodes.length} memórias`}>
      {size.w > 0 && (
        <ForceGraph3D
          ref={fg}
          width={size.w} height={size.h}
          graphData={data}
          backgroundColor={ink.bg}
          showNavInfo={false}
          cooldownTicks={reduced() ? 20 : 200}
          nodeRelSize={3}
          nodeVal={(n) => ((n as N).id === selected ? 2.5 : 1) * ((n as N).degree + 1)}
          nodeColor={(n) => nodeColor(n as N)}
          nodeOpacity={0.95}
          nodeResolution={16}
          nodeLabel={(n) => escapeHtml((n as N).text.slice(0, 120))}
          linkColor={() => ink.link}
          linkOpacity={0.35}
          linkWidth={0}
          onNodeClick={(n) => onSelect((n as N).id)}
          onEngineStop={() => {
            if (fitted.current) return;
            fitted.current = true;
            fit();
          }}
        />
      )}
      <VStack gap={1} className="graph-zoom">
        <IconButton label="Aproximar" tooltip="Aproximar" size="sm" icon={<Icon icon={Plus} size="sm" />} onClick={() => zoom(0.7)} />
        <IconButton label="Afastar" tooltip="Afastar" size="sm" icon={<Icon icon={Minus} size="sm" />} onClick={() => zoom(1.4)} />
        <IconButton label="Centralizar" tooltip="Centralizar" size="sm" icon={<Icon icon={Maximize} size="sm" />} onClick={fit} />
      </VStack>
    </div>
  );
}
