import { describe, expect, it } from "vitest";
import { priceCart, type VariantRow } from "./cart";

const v = (id: string, o: Partial<VariantRow> = {}): VariantRow => ({
  id, productId: "p1", productName: "Camiseta", color: "Preto", size: "M", sku: `S-${id}`, priceCents: 5000, stock: 10, active: true, imageUrl: null, ...o,
});

describe("priceCart", () => {
  it("preco vem da variacao, nao da linha", () => {
    const r = priceCart([{ variantId: "a", qty: 2, priceCents: 1 } as never], [v("a")]);
    expect(r.lines).toEqual([{ variantId: "a", productName: "Camiseta", color: "Preto", size: "M", qty: 2, unitCents: 5000, lineCents: 10000, imageUrl: null }]);
    expect(r.subtotalCents).toBe(10000);
    expect(r.issues).toEqual([]);
  });
  it("variacao inativa -> INACTIVE fora do subtotal (produto inativo nem chega em variants: ver rota)", () => {
    const r = priceCart([{ variantId: "a", qty: 1 }], [v("a", { active: false })]);
    expect(r.lines).toEqual([]);
    expect(r.subtotalCents).toBe(0);
    expect(r.issues).toEqual([{ variantId: "a", kind: "INACTIVE", available: 0 }]);
  });
  it("variacao desconhecida/de outra loja (ausente em variants) -> INACTIVE", () => {
    expect(priceCart([{ variantId: "x", qty: 1 }], [v("a")])).toEqual({ lines: [], subtotalCents: 0, issues: [{ variantId: "x", kind: "INACTIVE", available: 0 }] });
  });
  it("estoque 0 -> OUT_OF_STOCK excluida", () => {
    const r = priceCart([{ variantId: "a", qty: 1 }], [v("a", { stock: 0 })]);
    expect(r.lines).toEqual([]);
    expect(r.issues).toEqual([{ variantId: "a", kind: "OUT_OF_STOCK", available: 0 }]);
  });
  it("qty acima do estoque -> mantida no estoque com QTY_REDUCED", () => {
    const r = priceCart([{ variantId: "a", qty: 5 }], [v("a", { stock: 3 })]);
    expect(r.lines[0]).toMatchObject({ qty: 3, lineCents: 15000 });
    expect(r.subtotalCents).toBe(15000);
    expect(r.issues).toEqual([{ variantId: "a", kind: "QTY_REDUCED", available: 3 }]);
  });
  it("qty <= 0, NaN e nao inteira sao descartadas", () => {
    const r = priceCart([0, -1, NaN, 1.5, Infinity].map((qty) => ({ variantId: "a", qty })), [v("a")]);
    expect(r).toEqual({ lines: [], subtotalCents: 0, issues: [] });
  });
  it("duplicatas somam qty", () => {
    const r = priceCart([{ variantId: "a", qty: 2 }, { variantId: "a", qty: 3 }], [v("a")]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].qty).toBe(5);
  });
  it("qty limitada a 99 antes do estoque", () => {
    const r = priceCart([{ variantId: "a", qty: 1000 }], [v("a", { stock: 500 })]);
    expect(r.lines[0].qty).toBe(99);
    expect(r.issues).toEqual([]);
  });
  it("ordem de linhas e issues segue a entrada", () => {
    const r = priceCart(
      [{ variantId: "c", qty: 1 }, { variantId: "a", qty: 9 }, { variantId: "b", qty: 1 }, { variantId: "z", qty: 1 }],
      [v("a", { stock: 2 }), v("b"), v("c", { stock: 0 })],
    );
    expect(r.lines.map((l) => l.variantId)).toEqual(["a", "b"]);
    expect(r.issues.map((i) => i.variantId)).toEqual(["c", "a", "z"]);
  });
});
