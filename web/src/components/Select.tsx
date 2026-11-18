import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

type Option = { value: string; label: string };
const FILTER_FROM = 8; // a partir de quantas opções a lista ganha campo de busca

// Substitui o <select> nativo: a lista aberta do nativo é desenhada pelo SO e não segue o Grafite.
export function Select({ value, options, onChange, label, id }: {
  value: string; options: Option[]; onChange: (v: string) => void; label: string; id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];
  const filterable = options.length > FILTER_FROM;
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    // rolar a página (fora da própria lista) fecha: a lista é posicionada em relação ao botão
    const scroll = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const resize = () => setOpen(false);
    document.addEventListener("mousedown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);

  const show = () => { setQ(""); setActive(Math.max(0, options.indexOf(current))); setOpen(true); };
  const close = () => { setOpen(false); btn.current?.focus(); };
  const pick = (o: Option | undefined) => { if (o) onChange(o.value); close(); };

  const onKey = (e: KeyboardEvent) => {
    const last = shown.length - 1;
    const typing = e.target !== btn.current;
    const move: Record<string, () => void> = {
      ArrowDown: () => (open ? setActive(Math.min(last, active + 1)) : show()),
      ArrowUp: () => (open ? setActive(Math.max(0, active - 1)) : show()),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => (open ? pick(shown[active]) : show()),
      Escape: () => close(),
      Tab: () => setOpen(false),
    };
    if (!typing) move[" "] = () => (open ? pick(shown[active]) : show());
    if (typing && (e.key === "Home" || e.key === "End")) return; // no campo, Home/End movem o cursor
    if (!move[e.key]) return;
    if (e.key !== "Tab") e.preventDefault();
    move[e.key]();
  };

  return (
    <div className="select" ref={root}>
      <button ref={btn} id={id} type="button" className="field select-btn" role="combobox" aria-label={label}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={open && !filterable ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}>
        <span>{current?.label}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="select-pop">
          {filterable && (
            <div className="select-filter">
              <Search size={14} aria-hidden />
              <input autoFocus value={q} placeholder="Filtrar" aria-label={`Filtrar ${label}`}
                aria-controls={listId} aria-activedescendant={shown.length ? `${listId}-${active}` : undefined}
                onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} />
            </div>
          )}
          <ul id={listId} role="listbox" className="select-list" aria-label={label}>
            {shown.map((o, i) => (
              <li key={o.value} id={`${listId}-${i}`} role="option" aria-selected={o.value === value}
                className={(i === active ? "active " : "") + (o.value === value ? "on" : "")}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
                {o.label}{o.value === value && <Check size={14} aria-hidden />}
              </li>
            ))}
            {shown.length === 0 && <li className="empty muted" role="presentation">Nada encontrado</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
