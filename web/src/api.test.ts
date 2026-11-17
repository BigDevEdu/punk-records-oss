import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request, setOnUnauthorized } from "./api";

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe("request", () => {
  it("401 chama onUnauthorized e rejeita", async () => {
    const on = vi.fn();
    setOnUnauthorized(on);
    vi.stubGlobal("fetch", reply(401, { error: "unauthorized", detail: "sem sessão" }));
    await expect(request("/me")).rejects.toBeInstanceOf(ApiError);
    expect(on).toHaveBeenCalledOnce();
  });

  it("erro JSON vira ApiError com detail", async () => {
    setOnUnauthorized(vi.fn());
    vi.stubGlobal("fetch", reply(400, { error: "invalid", detail: "q vazio" }));
    await expect(request("/search")).rejects.toMatchObject({ code: "invalid", detail: "q vazio" });
  });

  it("prefixa /admin/api e devolve o JSON", async () => {
    const f = reply(200, { agent_id: "a", role: "global" });
    vi.stubGlobal("fetch", f);
    expect(await request("/me")).toEqual({ agent_id: "a", role: "global" });
    expect(f.mock.calls[0][0]).toBe("/admin/api/me");
    expect(f.mock.calls[0][1]).toMatchObject({ credentials: "same-origin" });
  });
});
