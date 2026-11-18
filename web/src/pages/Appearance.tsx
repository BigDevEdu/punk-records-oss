import { Link } from "react-router-dom";
import { Monitor, Moon, Sun } from "lucide-react";
import { Theme, setPrefs, usePrefs } from "../prefs";

const THEMES: { id: Theme; label: string; icon: JSX.Element }[] = [
  { id: "system", label: "Sistema", icon: <Monitor size={15} aria-hidden /> },
  { id: "dark", label: "Escuro", icon: <Moon size={15} aria-hidden /> },
  { id: "light", label: "Claro", icon: <Sun size={15} aria-hidden /> },
];

export default function Appearance() {
  const prefs = usePrefs();

  return (
    <>
      <div className="topbar"><span>Aparência</span></div>
      <div className="settings">
        <section className="grouped settings-block">
          <header>
            <h2>Tema</h2>
            <p className="muted">"Sistema" acompanha o modo claro ou escuro do seu computador.</p>
          </header>
          <div className="seg-btns theme-pick" role="radiogroup" aria-label="Tema">
            {THEMES.map((t) => (
              <button key={t.id} className="plain" role="radio" aria-checked={prefs.theme === t.id}
                onClick={() => setPrefs({ theme: t.id })}>{t.icon}{t.label}</button>
            ))}
          </div>
        </section>

        <p className="muted hint">As cores de cada projeto ficam em <Link to="/projetos">Projetos</Link>.</p>
      </div>
    </>
  );
}
