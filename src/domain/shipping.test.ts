import { describe, expect, it } from "vitest";
import type { PricedLine } from "./cart";
import { LIMITS, MINIMUMS, buildPackages, createQuoteCache, packagesHash } from "./shipping";

const line = (variantId: string, qty: number, unitCents = 1000): PricedLine => ({
  variantId, productName: "P", color: "c", size: "m", qty, unitCents, lineCents: unitCents * qty, imageUrl: null,
});
const d = (weightGrams: number, heightCm: number, widthCm: number, lengthCm: number) => ({ weightGrams, heightCm, widthCm, lengthCm });

describe("buildPackages", () => {
  it("soma pesos (qtd x peso), empilha altura, maior largura/comprimento, seguro = valor", () => {
    const dims = new Map([["a", d(300, 3, 20, 30)], ["b", d(500, 2, 25, 20)]]);
    const [p, ...rest] = buildPackages([line("a", 2, 1000), line("b", 1, 500)], dims);
    expect(rest).toEqual([]);
    expect(p).toEqual({ weightGrams: 1100, heightCm: 8, widthCm: 25, lengthCm: 30, insuranceCents: 2500 });
  });

  it("aplica minimos dos Correios", () => {
    const [p] = buildPackages([line("a", 1)], new Map([["a", d(1, 1, 1, 1)]]));
    expect(p).toMatchObject({ weightGrams: MINIMUMS.weightGrams, heightCm: MINIMUMS.heightCm, widthCm: MINIMUMS.widthCm, lengthCm: MINIMUMS.lengthCm });
  });

  it("divide em varios pacotes ao passar do peso maximo, preservando peso e seguro totais", () => {
    const pk = buildPackages([line("a", 5, 2000)], new Map([["a", d(10000, 5, 20, 20)]]));
    expect(pk.length).toBe(2);
    expect(pk.map((p) => p.weightGrams)).toEqual([30000, 20000]);
    expect(pk.every((p) => p.weightGrams <= LIMITS.weightGrams)).toBe(true);
    expect(pk.reduce((s, p) => s + p.insuranceCents, 0)).toBe(10000);
  });

  it("divide ao passar do lado maximo / soma das dimensoes", () => {
    const side = buildPackages([line("a", 3)], new Map([["a", d(100, 40, 20, 20)]])); // altura 40,80,120 > 105
    expect(side.length).toBe(2);
    expect(side.every((p) => p.heightCm <= LIMITS.sideCm)).toBe(true);
    const sum = buildPackages([line("a", 5)], new Map([["a", d(100, 20, 52, 52)]])); // 5 un: altura 100 (< 105) mas soma 204 > 200
    expect(sum.map((p) => p.heightCm)).toEqual([80, 20]);
    expect(sum.every((p) => p.heightCm + p.widthCm + p.lengthCm <= LIMITS.sumCm)).toBe(true);
  });

  it("ignora linha sem dimensoes conhecidas e carrinho vazio -> []", () => {
    expect(buildPackages([line("x", 1)], new Map())).toEqual([]);
    expect(buildPackages([], new Map())).toEqual([]);
  });
});

describe("cache de cotacao", () => {
  const pk = [{ weightGrams: 100, heightCm: 2, widthCm: 11, lengthCm: 16, insuranceCents: 0 }];
  it("expira em 10 min pelo relogio injetado e separa lojas", () => {
    let t = 0;
    const c = createQuoteCache({ now: () => t });
    const opts = [{ service: "PAC", priceCents: 1, days: 1 }];
    c.set("A", "01001000", "37175000", pk, opts);
    expect(c.get("A", "01001000", "37175000", pk)).toEqual(opts);
    expect(c.get("B", "01001000", "37175000", pk)).toBeUndefined();
    t = 10 * 60 * 1000 + 1;
    expect(c.get("A", "01001000", "37175000", pk)).toBeUndefined();
  });
  it("evicta o mais antigo no limite", () => {
    const c = createQuoteCache({ max: 2 });
    for (const s of ["1", "2", "3"]) c.set(s, "x", "y", pk, []);
    expect(c.get("1", "x", "y", pk)).toBeUndefined();
    expect(c.get("3", "x", "y", pk)).toEqual([]);
  });
  it("hash muda com o pacote", () => {
    expect(packagesHash(pk)).not.toBe(packagesHash([{ ...pk[0], weightGrams: 101 }]));
  });
});
