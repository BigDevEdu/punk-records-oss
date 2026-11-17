import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import { escapeHtml } from "../escape";
import { Cluster, GraphEdge, GraphNode } from "../api";

type Props = {
  nodes: GraphNode[]; edges: GraphEdge[]; clusters: Cluster[];
  color: (project: string) => string;
  highlight: Set<string> | null; selected: string | null; onSelect: (id: string) => void;
};
type N = GraphNode & { x?: number; y?: number };

const radius = (n: GraphNode) => 2.5 * Math.sqrt(n.degree + 1);
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  const dim = (id: string) => (highlight && !highlight.has(id) ? 0.2 : 1);

  return (
    <div ref={box} className="graph" role="img" aria-label={`Grafo com ${nodes.length} memórias`}>
      {size.w > 0 && (
        <ForceGraph2D
          ref={fg}
          width={size.w} height={size.h}
          graphData={data}
          backgroundColor="#16181d"
          cooldownTicks={reduced() ? 20 : 200}
          nodeRelSize={1}
          linkColor={() => "#3a404b"}
          linkWidth={0.6}
          nodeLabel={(n) => escapeHtml((n as N).text.slice(0, 120))}
          onNodeClick={(n) => onSelect((n as N).id)}
          nodeCanvasObject={(n, ctx) => {
            const nd = n as N;
            const r = radius(nd);
            ctx.globalAlpha = dim(nd.id);
            ctx.beginPath(); ctx.arc(nd.x!, nd.y!, r, 0, 2 * Math.PI);
            ctx.fillStyle = color(nd.project); ctx.fill();
            if (nd.id === selected) {
              ctx.beginPath(); ctx.arc(nd.x!, nd.y!, r + 3, 0, 2 * Math.PI);
              ctx.strokeStyle = "#e3e6eb"; ctx.lineWidth = 1.2; ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(n, c, ctx) => {
            const nd = n as N;
            ctx.fillStyle = c; ctx.beginPath(); ctx.arc(nd.x!, nd.y!, radius(nd) + 2, 0, 2 * Math.PI); ctx.fill();
          }}
          onRenderFramePost={(ctx, scale) => {
            ctx.font = `${11 / scale}px "IBM Plex Sans", sans-serif`;
            ctx.fillStyle = "#8f96a3"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            for (const c of clusters) {
              const pts = c.node_ids.map((i) => byId.get(i)).filter((n): n is N => !!n && n.x !== undefined);
              if (!pts.length) continue;
              ctx.fillText(c.label, pts.reduce((s, n) => s + n.x!, 0) / pts.length, pts.reduce((s, n) => s + n.y!, 0) / pts.length);
            }
          }}
        />
      )}
      <div className="zoom">
        <button className="plain" aria-label="Aproximar" onClick={() => fg.current?.zoom(fg.current.zoom() * 1.4, 200)}>+</button>
        <button className="plain" aria-label="Afastar" onClick={() => fg.current?.zoom(fg.current.zoom() / 1.4, 200)}>−</button>
        <button className="plain" aria-label="Centralizar" onClick={() => fg.current?.zoomToFit(300, 40)}>Centralizar</button>
      </div>
    </div>
  );
}
