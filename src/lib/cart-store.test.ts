import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("location", { host: "loja.localhost" });
vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
const cart = await import("./cart-store");

beforeEach(() => mem.clear());

describe("cart-store", () => {
  it("add soma, setQty troca, remove e clear", () => {
    cart.add("a"); cart.add("a", 2); cart.add("b");
    expect(cart.read()).toEqual([{ variantId: "a", qty: 3 }, { variantId: "b", qty: 1 }]);
    cart.setQty("a", 1);
    expect(cart.read()[0].qty).toBe(1);
    cart.setQty("b", 0);
    expect(cart.read()).toEqual([{ variantId: "a", qty: 1 }]);
    cart.remove("a");
    expect(cart.read()).toEqual([]);
    cart.add("c"); cart.clear();
    expect(cart.read()).toEqual([]);
  });
  it("chave por loja e referencia estavel sem mudanca", () => {
    cart.add("a");
    expect(mem.has("cart:loja.localhost")).toBe(true);
    expect(cart.read()).toBe(cart.read());
  });
  it("JSON malformado ou formato errado -> carrinho vazio; linhas ruins descartadas", () => {
    mem.set("cart:loja.localhost", "{nao json");
    expect(cart.read()).toEqual([]);
    mem.set("cart:loja.localhost", '{"a":1}');
    expect(cart.read()).toEqual([]);
    mem.set("cart:loja.localhost", '[{"variantId":"a","qty":2},{"variantId":1,"qty":1},{"variantId":"b","qty":-1},null]');
    expect(cart.read()).toEqual([{ variantId: "a", qty: 2 }]);
  });
  it("notifica assinantes e replace troca tudo", () => {
    const cb = vi.fn();
    cart.subscribe(cb);
    cart.add("a");
    expect(cb).toHaveBeenCalledTimes(1);
    cart.replace([{ variantId: "z", qty: 4 }]);
    expect(cart.read()).toEqual([{ variantId: "z", qty: 4 }]);
  });
});
