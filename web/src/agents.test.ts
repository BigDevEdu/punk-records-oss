import { describe, expect, it } from "vitest";
import { parsePrefs } from "./prefs";
import { ID_RE, dayLabel, latency, outcomeLabel, permissions, relativeTime, roleLabel, statusOf, toolLabel } from "./agents";

describe("relativeTime", () => {
  const now = 1_000_000;
  it("formata em pt-BR", () => {
    expect(relativeTime(now - 10, now)).toBe("agora");
    expect(relativeTime(now - 180, now)).toBe("há 3 min");
    expect(relativeTime(now - 3700, now)).toBe("há 1 h");
    expect(relativeTime(now - 86400 * 1.2, now)).toBe("ontem");
    expect(relativeTime(now - 86400 * 12, now)).toBe("há 12 dias");
  });
});

describe("statusOf", () => {
  it("revogado, sem uso, ativo", () => {
    expect(statusOf({ disabled: true, last_used_at: 5 })).toBe("Revogado");
    expect(statusOf({ disabled: false, last_used_at: null })).toBe("Sem uso");
    expect(statusOf({ disabled: false, last_used_at: 5 })).toBe("Ativo");
  });
});

describe("permissions", () => {
  const all = [{ name: "a" }, { name: "b" }, { name: "_shared" }];
  it("agent edita só as próprias", () => {
    expect(permissions("agent", ["a"], all)).toEqual([
      { project: "a", read: "tudo", edit: "as próprias" },
      { project: "_shared", read: "tudo", edit: "as próprias" },
    ]);
  });
  it("project_admin edita tudo dos projetos dele, _shared só as próprias", () => {
    const p = permissions("project_admin", ["a"], all);
    expect(p[0].edit).toBe("tudo do projeto");
    expect(p[1]).toEqual({ project: "_shared", read: "tudo", edit: "as próprias" });
  });
  it("global lê e edita tudo", () => {
    const p = permissions("global", [], all);
    expect(p.map((r) => r.project)).toEqual(["a", "b", "_shared"]);
    expect(p.every((r) => r.edit === "tudo")).toBe(true);
  });
});

describe("ID_RE", () => {
  it("valida ids", () => {
    expect(ID_RE.test("cursor-trabalho")).toBe(true);
    expect(ID_RE.test("Ab")).toBe(false);
    expect(ID_RE.test("-ab")).toBe(false);
    expect(ID_RE.test("a")).toBe(false);
  });
});

describe("rótulos", () => {
  it("traduz ids conhecidos e mantém os desconhecidos", () => {
    expect(roleLabel("project_admin")).toBe("Admin de projeto");
    expect(toolLabel("memory_query")).toBe("Buscou");
    expect(outcomeLabel("not_found")).toBe("Não encontrado");
    expect(toolLabel("memory_nova")).toBe("memory_nova");
  });
});

describe("dayLabel e latency", () => {
  const now = new Date(2026, 10, 18, 10, 0).getTime() / 1000;
  it("agrupa por dia local", () => {
    expect(dayLabel(new Date(2026, 10, 18, 0, 5).getTime() / 1000, now)).toBe("Hoje");
    expect(dayLabel(new Date(2026, 10, 17, 23, 59).getTime() / 1000, now)).toBe("Ontem");
    expect(dayLabel(new Date(2026, 10, 16, 12).getTime() / 1000, now)).toMatch(/16/);
  });
  it("formata latência", () => {
    expect(latency(42.4)).toBe("42 ms");
    expect(latency(1250)).toBe("1,3 s");
  });
});

describe("parsePrefs", () => {
  it("aceita só tema conhecido e cores hex", () => {
    expect(parsePrefs('{"theme":"light","colors":{"a":"#112233","b":"red","c":"#12"}}')).toEqual({ theme: "light", colors: { a: "#112233" } });
    expect(parsePrefs('{"theme":"neon"}').theme).toBe("system");
    expect(parsePrefs("não é json")).toEqual({ theme: "system", colors: {} });
    expect(parsePrefs(null)).toEqual({ theme: "system", colors: {} });
  });
});
