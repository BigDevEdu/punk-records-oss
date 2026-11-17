import { expect, test } from "vitest";
import { escapeHtml } from "./escape";

test("escapa tags e aspas", () => {
  const out = escapeHtml("<img src=x onerror=alert(1)>");
  expect(out).not.toMatch(/[<>]/);
  expect(escapeHtml(`"'`)).toBe("&quot;&#39;");
});
test("escapa & primeiro", () => {
  expect(escapeHtml("&lt;")).toBe("&amp;lt;");
});
