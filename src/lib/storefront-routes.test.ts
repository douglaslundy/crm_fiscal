import { describe, expect, it } from "vitest";
import { storefrontPath } from "./storefront-routes";

describe("storefrontPath", () => {
  it("caminhos publicos da vitrine viram /vitrine + caminho", () => {
    expect(storefrontPath("/")).toBe("/vitrine");
    expect(storefrontPath("/c/camisetas")).toBe("/vitrine/c/camisetas");
    expect(storefrontPath("/p/camiseta-basica")).toBe("/vitrine/p/camiseta-basica");
    expect(storefrontPath("/buscar")).toBe("/vitrine/buscar");
  });
  it("demais caminhos nao sao reescritos", () => {
    for (const p of ["/admin", "/admin/produtos", "/entrar", "/loja-entrar", "/cadastro", "/api/admin/x", "/master",
      "/_next/data/x", "/carrinho", "/checkout", "/conta", "/c", "/c/", "/p", "/p/", "/c/a/b", "/buscarx", "/buscar/x", "/vitrine", "/vitrine/p/x", "/cx/a"]) {
      expect(storefrontPath(p), p).toBeNull();
    }
  });
});
