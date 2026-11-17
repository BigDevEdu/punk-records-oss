import { describe, expect, it } from "vitest";
import { ID_RE, permissions, relativeTime, statusOf } from "./agents";

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
