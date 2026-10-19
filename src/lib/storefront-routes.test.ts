import { describe, expect, it } from "vitest";
import { storefrontPath } from "./storefront-routes";

describe("storefrontPath", () => {
  it("caminhos publicos da vitrine viram /vitrine + caminho", () => {
    expect(storefrontPath("/")).toBe("/vitrine");
    expect(storefrontPath("/c/camisetas")).toBe("/vitrine/c/camisetas");
    expect(storefrontPath("/p/camiseta-basica")).toBe("/vitrine/p/camiseta-basica");
    expect(storefrontPath("/colecao/verao")).toBe("/vitrine/colecao/verao");
    expect(storefrontPath("/buscar")).toBe("/vitrine/buscar");
    expect(storefrontPath("/carrinho")).toBe("/vitrine/carrinho");
    expect(storefrontPath("/checkout")).toBe("/vitrine/checkout");
    expect(storefrontPath("/pedido/ck123")).toBe("/vitrine/pedido/ck123");
    expect(storefrontPath("/conta")).toBe("/vitrine/conta");
    expect(storefrontPath("/conta/enderecos")).toBe("/vitrine/conta/enderecos");
    expect(storefrontPath("/conta/pedidos/ck1")).toBe("/vitrine/conta/pedidos/ck1");
  });
  it("demais caminhos nao sao reescritos", () => {
    for (const p of ["/admin", "/admin/produtos", "/entrar", "/loja-entrar", "/cadastro", "/api/admin/x", "/master",
      "/_next/data/x", "/carrinho/x", "/carrinho/", "/checkout/", "/checkout/x", "/conta/", "/conta/x", "/conta/enderecos/x", "/conta/pedidos", "/conta/pedidos/", "/conta/pedidos/a/b", "/colecao", "/colecao/", "/colecao/a/b", "/c", "/c/", "/p", "/p/", "/c/a/b", "/buscarx", "/buscar/x", "/vitrine", "/vitrine/p/x", "/cx/a", "/pedido", "/pedido/", "/pedido/a/b", "/pedidos/a"]) {
      expect(storefrontPath(p), p).toBeNull();
    }
  });
});
