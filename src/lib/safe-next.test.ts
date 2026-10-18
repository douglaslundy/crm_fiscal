import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("aceita caminho relativo do mesmo site", () => {
    expect(safeNext("/conta", "/")).toBe("/conta");
    expect(safeNext("/admin/pedidos?x=1#a", "/")).toBe("/admin/pedidos?x=1#a");
  });
  it("rejeita externo, protocolo-relativo, barra invertida e vazio", () => {
    for (const raw of ["//evil.com", "/\\evil.com", "\\\\evil.com", "http://evil.com", "https://evil.com/x", "javascript:alert(1)", "conta", "", "/a\\b", "/\nx"]) {
      expect(safeNext(raw, "/fb"), JSON.stringify(raw)).toBe("/fb");
    }
    expect(safeNext(null, "/fb")).toBe("/fb");
    expect(safeNext(undefined, "/fb")).toBe("/fb");
    expect(safeNext(["/a"], "/fb")).toBe("/fb");
  });
});
