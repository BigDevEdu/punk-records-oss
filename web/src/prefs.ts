import { useSyncExternalStore } from "react";

// Preferências de visualização deste navegador: tema e cor de cada projeto.
// ponytail: localStorage, por navegador; levar ao backend se precisar valer para todos os admins.
export type Theme = "system" | "dark" | "light";
export type Prefs = { theme: Theme; colors: Record<string, string> };

const KEY = "punk-records:prefs";
const DEFAULTS: Prefs = { theme: "system", colors: {} };
const HEX = /^#[0-9a-f]{6}$/i;

export function parsePrefs(raw: string | null): Prefs {
  try {
    const p = JSON.parse(raw ?? "{}");
    const theme: Theme = ["system", "dark", "light"].includes(p.theme) ? p.theme : "system";
    const colors = Object.fromEntries(
      Object.entries(p.colors ?? {}).filter((e): e is [string, string] => typeof e[1] === "string" && HEX.test(e[1])),
    );
    return { theme, colors };
  } catch {
    return DEFAULTS;
  }
}

let prefs: Prefs = (() => { try { return parsePrefs(localStorage.getItem(KEY)); } catch { return DEFAULTS; } })();
const listeners = new Set<() => void>();
const light = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: light)") : null;

export const resolvedTheme = (t = prefs.theme): "dark" | "light" =>
  t === "system" ? (light?.matches ? "light" : "dark") : t;

// o <Theme> do Astryx aplica o modo; aqui só avisa quem desenha fora dele (o canvas do grafo)
function apply() {
  listeners.forEach((l) => l());
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* modo privado: vale só nesta aba */ }
  apply();
}

export function setProjectColor(name: string, color: string | null) {
  const colors = { ...prefs.colors };
  if (color) colors[name] = color; else delete colors[name];
  setPrefs({ colors });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const usePrefs = (): Prefs => useSyncExternalStore(subscribe, () => prefs);
// tema efetivo ("sistema" já resolvido): muda também quando o SO troca de modo
export const useTheme = () => useSyncExternalStore(subscribe, () => resolvedTheme());

light?.addEventListener("change", () => { if (prefs.theme === "system") apply(); });
