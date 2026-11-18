import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ArrowRight, Check, RotateCcw, Trash2 } from "lucide-react";
import { ApiError, SWATCHES, SWATCH_NAMES, projectColor, request } from "../api";
import { SHARED } from "../agents";
import { Select } from "../components/Select";
import { setPrefs, setProjectColor, usePrefs } from "../prefs";
import type { LayoutCtx } from "../Layout";

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
      setError(e instanceof ApiError ? e.detail : "Não foi possível falar com o servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="topbar"><span>Projetos</span></div>
      <div className="settings">
        {done && (
          <p className="notice-ok" role="status">
            <Check size={14} aria-hidden />
            Projeto {done.project} excluído. {plural(done.moved, "memória movida", "memórias movidas")} para {done.move_to}
            {done.agents.length > 0 && <> · {plural(done.agents.length, "agente passou", "agentes passaram")} a ter acesso a {done.move_to}</>}.
          </p>
        )}
        <section className="grouped settings-block">
          <header>
            <h2>Projetos</h2>
            <p className="muted">A cor vale no grafo, na barra lateral e nas listas, e fica salva neste navegador.
              Excluir um projeto move as memórias dele para outro; nenhuma memória é apagada.</p>
          </header>
          <ul className="color-rows">
            {projects.map((p) => {
              const current = colorOf(p.name);
              const others = projects.filter((o) => o.name !== p.name);
              const gaining = agents.filter((a) => a.projects.includes(p.name));
              return (
                <li key={p.name} className="project-row">
                  <div className="project-head">
                    <span className="color-name">
                      <span className="sq big" style={{ background: current }} />{p.name}
                      <span className="muted count-text">{plural(p.count, "memória", "memórias")}</span>
                    </span>
                    {p.name === SHARED
                      ? <span className="muted hint">Compartilhado com todos; não pode ser excluído.</span>
                      : <button className="plain danger" aria-expanded={deleting === p.name} onClick={() => startDelete(p.name)}>
                          <Trash2 size={14} aria-hidden />Excluir
                        </button>}
                  </div>
                  <div className="swatches" role="radiogroup" aria-label={`Cor de ${p.name}`}>
                    {SWATCHES.map((c, i) => (
                      <button key={c} className="swatch" role="radio" aria-checked={current === c}
                        aria-label={SWATCH_NAMES[i]} data-tip={SWATCH_NAMES[i]} style={{ background: c }}
                        onClick={() => setProjectColor(p.name, c === projectColor(p.color_index) ? null : c)}>
                        {current === c && <Check size={12} aria-hidden />}
                      </button>
                    ))}
                  </div>
                  {deleting === p.name && (
                    <div className="confirm" role="alertdialog" aria-label={`Excluir o projeto ${p.name}`}>
                      <p>
                        Excluir <b>{p.name}</b>? {p.count > 0
                          ? <>As {plural(p.count, "memória", "memórias")} dele vão para:</>
                          : <>Ele não tem memórias. Agentes com acesso a ele passam para:</>}
                      </p>
                      <div className="move-to">
                        <span className="sq" style={{ background: current }} />{p.name}
                        <ArrowRight size={14} aria-hidden className="muted" />
                        <Select label="Mover para" value={target} onChange={setTarget}
                          options={others.map((o) => ({ value: o.name, label: o.name === SHARED ? "_shared (todos veem)" : o.name }))} />
                      </div>
                      {gaining.length > 0 && target !== SHARED && (
                        <p className="muted hint">
                          {gaining.map((a) => a.id).join(", ")} {gaining.length === 1 ? "tinha" : "tinham"} acesso
                          a {p.name} e {gaining.length === 1 ? "passa" : "passam"} a ter acesso a <b>{target}</b>, para continuar vendo essas memórias.
                        </p>
                      )}
                      {target === SHARED && p.count > 0 && (
                        <p className="muted hint">Em _shared, as memórias ficam visíveis para todos os agentes.</p>
                      )}
                      {error && <p className="error" role="alert">{error}</p>}
                      <div className="row">
                        <button className="plain" autoFocus onClick={() => setDeleting(null)}>Cancelar</button>
                        <button className="plain danger" disabled={busy || !target} onClick={() => confirmDelete(p.name)}>
                          <Trash2 size={14} aria-hidden />{busy ? "Movendo" : "Mover e excluir"}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="row end">
            <button className="plain" disabled={Object.keys(prefs.colors).length === 0} onClick={() => setPrefs({ colors: {} })}>
              <RotateCcw size={14} aria-hidden />Restaurar cores padrão
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
