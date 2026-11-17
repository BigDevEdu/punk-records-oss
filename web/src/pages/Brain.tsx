import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { ApiError, GraphResponse, SearchHit, projectColor, request } from "../api";
import type { LayoutCtx } from "../Layout";
import Graph from "../components/Graph";
import MemoryPanel from "../components/MemoryPanel";

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
  const { agents, projects } = useOutletContext<LayoutCtx>();
  const [params, setParams] = useSearchParams();
  const as = params.get("as");
  const narrow = useNarrow();
  const searchRef = useRef<HTMLInputElement>(null);

  const [minSim, setMinSim] = useState(0.55);
  const [debounced, setDebounced] = useState(0.55);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchError, setSearchError] = useState("");

  const colors = useMemo(() => new Map(projects.map((p) => [p.name, p.color_index])), [projects]);
  const color = (name: string) => projectColor(colors.get(name) ?? 0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(minSim), 300);
    return () => clearTimeout(t);
  }, [minSim]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // "Ver como" mudou: recarrega o grafo e limpa seleção e busca
  useEffect(() => { setSelected(null); setHits(null); }, [as]);

  useEffect(() => {
    let live = true;
    setError("");
    request<GraphResponse>(`/graph?min_sim=${debounced}` + (as ? `&as=${encodeURIComponent(as)}` : ""))
      .then((g) => { if (live) { setGraph(g); setLoadedAt(Date.now()); } })
      .catch((e) => live && setError(e instanceof ApiError ? e.detail : "Não foi possível falar com o servidor."));
    return () => { live = false; };
  }, [as, debounced, attempt]);

  function clear() { setQuery(""); setHits(null); setSearchError(""); setSelected(null); }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "Escape") clear();
      else if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return clear();
    setSearchError("");
    try {
      setHits(await request<SearchHit[]>(`/search?q=${encodeURIComponent(query)}` + (as ? `&as=${encodeURIComponent(as)}` : "")));
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.detail : "Não foi possível falar com o servidor.");
    }
  }

  function setAs(v: string) {
    const p = new URLSearchParams(params);
    if (v) p.set("as", v); else p.delete("as");
    setParams(p);
  }

  const highlight = useMemo(() => (hits ? new Set(hits.map((h) => h.id)) : null), [hits]);
  const seconds = Math.max(0, Math.round((now - loadedAt) / 1000));

  let body;
  if (error) {
    body = (
      <div className="loading">
        <p className="error" role="alert">{error}</p>
        <button className="plain" onClick={() => setAttempt(attempt + 1)}>Tentar de novo</button>
      </div>
    );
  } else if (!graph) {
    body = <div className="loading skeleton muted">Carregando</div>;
  } else if (graph.nodes.length === 0) {
    body = <div className="loading muted">Nenhuma memória ainda. Quando os agentes gravarem, elas aparecem aqui.</div>;
  } else if (narrow) {
    body = <div className="loading muted">Abra em uma tela maior para ver o grafo.</div>;
  } else {
    body = (
      <Graph nodes={graph.nodes} edges={graph.edges} clusters={graph.clusters} color={color}
        highlight={highlight} selected={selected} onSelect={setSelected} />
    );
  }

  return (
    <>
      <div className="topbar">
        <span className="muted">Cérebro</span><span className="muted">/</span>
        <span>{as ? `Como ${as}` : "Todos os projetos"}</span>
        <div className="grow" />
        <form onSubmit={runSearch} className="search">
          <input ref={searchRef} className="field" placeholder="Pesquisar memórias (/)" aria-label="Pesquisar memórias"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </form>
        <select className="field as-select" aria-label="Ver como" value={as ?? ""} onChange={(e) => setAs(e.target.value)}>
          <option value="">Ver como: todos</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
        </select>
      </div>
      {searchError && <p className="error pad" role="alert">{searchError}</p>}
      {hits && hits.length === 0 && <p className="muted pad">Nada encontrado para essa busca.</p>}
      <div className="brain-body">
        <div className="graph-wrap">{body}</div>
        {selected && !error && (
          <MemoryPanel id={selected} as={as} color={color} onClose={() => setSelected(null)}
            onSelect={setSelected} onChanged={() => setAttempt((a) => a + 1)} />
        )}
      </div>
      <div className="statusbar muted">
        <span>{fmt.format(graph?.total ?? 0)} memórias</span>
        <span>{fmt.format(graph?.edges.length ?? 0)} ligações</span>
        <label>
          Similaridade mínima{" "}
          <input type="range" min={0.3} max={0.95} step={0.05} value={minSim}
            onChange={(e) => setMinSim(Number(e.target.value))} />{" "}
          {minSim.toFixed(2).replace(".", ",")}
        </label>
        <span className="grow" />
        <span>Atualizado há {seconds} s</span>
      </div>
    </>
  );
}
