import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { List, Network, RefreshCw, Search, X } from "lucide-react";
import { ApiError, GraphResponse, SearchHit, request } from "../api";
import { Select } from "../components/Select";
import type { LayoutCtx } from "../Layout";
import Graph from "../components/Graph";
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
  const searchRef = useRef<HTMLInputElement>(null);
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
      .catch((e) => live && setError(e instanceof ApiError ? e.detail : "Não foi possível falar com o servidor."))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [as, projeto, debounced, attempt]);

  function clear() { searchSeq.current++; setQuery(""); setHits(null); setSearchError(""); setSelected(null); }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "Escape") { if (t.id !== "edit-text") clear(); }
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
    const seq = ++searchSeq.current;
    try {
      const r = await request<SearchHit[]>(`/search?q=${encodeURIComponent(query)}` + (as ? `&as=${encodeURIComponent(as)}` : ""));
      if (seq === searchSeq.current) setHits(r);
    } catch (err) {
      if (seq === searchSeq.current) setSearchError(err instanceof ApiError ? err.detail : "Não foi possível falar com o servidor.");
    }
  }

  function setParam(k: string, v: string) {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p);
  }
  const setAs = (v: string) => setParam("as", v);

  const highlight = useMemo(() => (hits && hits.length ? new Set(hits.map((h) => h.id)) : null), [hits]);

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
  } else if (asList) {
    // lista no lugar do grafo; no celular, com uma memória aberta, o painel ocupa o lugar da lista
    const list = [...graph.nodes].filter((n) => !highlight || highlight.has(n.id)).sort((a, b) => b.updated_at - a.updated_at);
    body = selected && narrow ? null : (
      <ul className="mem-list" aria-label="Memórias">
        {list.map((n) => (
          <li key={n.id}>
            <button className={"mem-item" + (n.id === selected ? " on" : "")} aria-current={n.id === selected || undefined}
              onClick={() => setSelected(n.id)}>
              <span className="mem-item-text">{n.text}</span>
              <span className="muted mem-item-meta">
                <span className="sq" style={{ background: color(n.project) }} />{n.project} · {relativeTime(n.updated_at)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
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
        {projeto ? (
          <span className="crumb-filter">
            <span className="sq" style={{ background: color(projeto) }} />{projeto}
            <button className="link" aria-label="Mostrar todos os projetos" data-tip="Mostrar todos" onClick={() => setParam("projeto", "")}><X size={13} aria-hidden /></button>
          </span>
        ) : <span>Todos os projetos</span>}
        {as && <span className="badge">Como {as}</span>}
        <div className="grow" />
        <form onSubmit={runSearch} className="search with-icon">
          <Search size={15} aria-hidden className="field-icon" />
          <input ref={searchRef} className="field" placeholder="Pesquisar memórias (/)" aria-label="Pesquisar memórias"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </form>
        {!narrow && (
          <div className="seg-btns" role="group" aria-label="Visualização">
            <button className="plain icon" aria-pressed={!asList} aria-label="Grafo" data-tip="Grafo" onClick={() => setParam("view", "")}><Network size={15} aria-hidden /></button>
            <button className="plain icon" aria-pressed={asList} aria-label="Lista" data-tip="Lista" onClick={() => setParam("view", "lista")}><List size={15} aria-hidden /></button>
          </div>
        )}
        <Select label="Ver como" value={as ?? ""} onChange={setAs}
          options={[{ value: "", label: "Ver como: todos" }, ...agents.map((a) => ({ value: a.id, label: a.id }))]} />
      </div>
      {searchError && <p className="error pad" role="alert">{searchError}</p>}
      {hits && hits.length === 0 && <p className="muted pad">Nada encontrado para essa busca.</p>}
      <div className="brain-body">
        {body && <div className={asList ? "list-wrap" : "graph-wrap"}>{body}</div>}
        {selected && !error && (
          <MemoryPanel id={selected} as={as} color={color} onClose={() => setSelected(null)}
            onSelect={setSelected} onChanged={() => setAttempt((a) => a + 1)} />
        )}
      </div>
      <div className="statusbar muted">
        <span>{projeto && graph ? `${fmt.format(graph.nodes.length)} de ${fmt.format(graph.total)} memórias` : `${fmt.format(graph?.total ?? 0)} memórias`}</span>
        {!asList && <span>{fmt.format(graph?.edges.length ?? 0)} ligações</span>}
        {!asList && <label>
          Similaridade mínima{" "}
          <input type="range" min={0.3} max={0.95} step={0.05} value={minSim}
            onChange={(e) => setMinSim(Number(e.target.value))} />{" "}
          {minSim.toFixed(2).replace(".", ",")}
        </label>}
        <span className="grow" />
        <button className="link muted refresh" disabled={loading} onClick={() => setAttempt((a) => a + 1)}>
          <RefreshCw size={13} aria-hidden className={loading ? "spin" : ""} />
          {loading ? "Atualizando" : `Atualizado ${relativeTime(loadedAt / 1000)}`}
        </button>
      </div>
    </>
  );
}
