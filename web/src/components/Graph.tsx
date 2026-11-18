import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import { Maximize, Minus, Plus } from "lucide-react";
import { escapeHtml } from "../escape";
import { Cluster, GraphEdge, GraphNode } from "../api";
import { useTheme } from "../prefs";

type Props = {
  nodes: GraphNode[]; edges: GraphEdge[]; clusters: Cluster[];
  color: (project: string) => string;
  highlight: Set<string> | null; selected: string | null; onSelect: (id: string) => void;
};
type N = GraphNode & { x?: number; y?: number };

const radius = (n: GraphNode) => 2.5 * Math.sqrt(n.degree + 1);
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// o canvas não entende var(--x): lê os tokens do CSS (fonte única das cores do tema)
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export default function Graph({ nodes, edges, clusters, color, highlight, selected, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods>();
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // a biblioteca muta os objetos (x, y, source/target): entrega cópias
  const data = useMemo(
    () => ({ nodes: nodes.map((n) => ({ ...n })) as N[], links: edges.map((e) => ({ ...e })) }),
    [nodes, edges],
  );
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);
  const fitted = useRef(false);
  useEffect(() => { fitted.current = false; }, [data]);

  // painel abriu (ou a área mudou de tamanho): traz o nó selecionado para o centro
  useEffect(() => {
    const n = selected ? byId.get(selected) : undefined;
    if (n?.x !== undefined) fg.current?.centerAt(n.x, n.y, reduced() ? 0 : 400);
  }, [selected, size.w, byId]);

  const theme = useTheme();
  const ink = useMemo(() => ({
    bg: token("--bg-canvas"), link: token("--graph-link"), ring: token("--text-primary"), label: token("--label-backdrop"),
  }), [theme]);
  const dim = (id: string) => (highlight && !highlight.has(id) ? 0.2 : 1);

  return (
    <div ref={box} className="graph" role="img" aria-label={`Grafo com ${nodes.length} memórias`}>
      {size.w > 0 && (
        <ForceGraph2D
          ref={fg}
          width={size.w} height={size.h}
          graphData={data}
          backgroundColor={ink.bg}
          cooldownTicks={reduced() ? 20 : 200}
          maxZoom={3} /* com poucas memórias, o enquadramento automático não infla as bolinhas */
          nodeRelSize={1}
          linkColor={() => ink.link}
          linkWidth={0.6}
          nodeLabel={(n) => escapeHtml((n as N).text.slice(0, 120))}
          onNodeClick={(n) => onSelect((n as N).id)}
          onEngineStop={() => {
            if (fitted.current) return;
            fitted.current = true;
            fg.current?.zoomToFit(reduced() ? 0 : 400, 80); // folga para os rótulos dos grupos
          }}
          nodeCanvasObject={(n, ctx) => {
            const nd = n as N;
            const r = radius(nd);
            ctx.globalAlpha = dim(nd.id);
            ctx.beginPath(); ctx.arc(nd.x!, nd.y!, r, 0, 2 * Math.PI);
            ctx.fillStyle = color(nd.project); ctx.fill();
            if (nd.id === selected) {
              ctx.beginPath(); ctx.arc(nd.x!, nd.y!, r + 3, 0, 2 * Math.PI);
              ctx.strokeStyle = ink.ring; ctx.lineWidth = 1.2; ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(n, c, ctx) => {
            const nd = n as N;
            ctx.fillStyle = c; ctx.beginPath(); ctx.arc(nd.x!, nd.y!, radius(nd) + 2, 0, 2 * Math.PI); ctx.fill();
          }}
          onRenderFramePost={(ctx, scale) => {
            // rótulo do grupo acima do nó mais alto, numa pílula: não fica embaixo das bolinhas
            const fs = 12 / scale, padX = 8 / scale, h = 20 / scale;
            ctx.font = `500 ${fs}px "Inter", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            for (const c of clusters) {
              const pts = c.node_ids.map((i) => byId.get(i)).filter((n): n is N => !!n && n.x !== undefined);
              if (!pts.length) continue;
              const x = pts.reduce((s, n) => s + n.x!, 0) / pts.length;
              const y = Math.min(...pts.map((n) => n.y! - radius(n))) - h;
              const w = ctx.measureText(c.label).width + padX * 2;
              ctx.fillStyle = ink.label;
              ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
              ctx.fillStyle = color(pts[0].project);
              ctx.fillText(c.label, x, y);
            }
          }}
        />
      )}
      <div className="zoom">
        <button className="plain icon" aria-label="Aproximar" data-tip-left="Aproximar" onClick={() => fg.current?.zoom(fg.current.zoom() * 1.4, 200)}><Plus size={16} aria-hidden /></button>
        <button className="plain icon" aria-label="Afastar" data-tip-left="Afastar" onClick={() => fg.current?.zoom(fg.current.zoom() / 1.4, 200)}><Minus size={16} aria-hidden /></button>
        <button className="plain icon" aria-label="Centralizar" data-tip-left="Centralizar" onClick={() => fg.current?.zoomToFit(300, 80)}><Maximize size={15} aria-hidden /></button>
      </div>
    </div>
  );
}
