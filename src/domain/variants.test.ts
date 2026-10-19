import { describe, expect, it } from "vitest";
import { VariantsError, expandVariants } from "./variants";

const base = { priceCents: 5990, stock: 3 };

describe("expandVariants", () => {
  it("2 cores x 3 tamanhos -> 6 itens com SKU unico prefixo-cor-tamanho", () => {
    const v = expandVariants(["Preto", "Branco"], ["P", "M", "G"], base, "CAM");
    expect(v).toHaveLength(6);
    expect(new Set(v.map((x) => x.sku)).size).toBe(6);
    expect(v[0]).toEqual({ color: "Preto", size: "P", sku: "cam-preto-p", priceCents: 5990, stock: 3 });
    expect(v.map((x) => x.sku)).toContain("cam-branco-g");
  });

  it("listas vazias -> []", () => {
    expect(expandVariants([], ["P"], base, "x")).toEqual([]);
    expect(expandVariants(["Azul"], [], base, "x")).toEqual([]);
    expect(expandVariants([], [], base, "x")).toEqual([]);
    expect(expandVariants(["  ", ""], ["P"], base, "x")).toEqual([]);
  });

  it("apara, remove duplicadas sem diferenciar maiusculas e tira acentos do SKU", () => {
    const v = expandVariants([" Azul Marinho ", "azul marinho", "Lilás"], ["p", "P ", "GG"], base, "Camiseta Básica");
    expect(v.map((x) => `${x.color}/${x.size}`)).toEqual(["Azul Marinho/p", "Azul Marinho/GG", "Lilás/p", "Lilás/GG"]);
    expect(v.map((x) => x.sku)).toEqual([
      "camiseta-basica-azul-marinho-p", "camiseta-basica-azul-marinho-gg", "camiseta-basica-lilas-p", "camiseta-basica-lilas-gg",
    ]);
  });

  it("valores que viram o mesmo SKU contam como o mesmo (SKU sempre unico)", () => {
    const v = expandVariants(["Azul-Claro", "azul claro"], ["P"], base, "x");
    expect(v).toHaveLength(1);
  });

  it.each([
    ["preco negativo", { priceCents: -1, stock: 0 }],
    ["preco zero", { priceCents: 0, stock: 0 }],
    ["preco fracionado", { priceCents: 10.5, stock: 0 }],
    ["estoque negativo", { priceCents: 100, stock: -1 }],
    ["estoque fracionado", { priceCents: 100, stock: 1.5 }],
    ["preco NaN", { priceCents: Number.NaN, stock: 1 }],
  ])("%s -> erro", (_l, b) => {
    expect(() => expandVariants(["A"], ["P"], b, "x")).toThrow(VariantsError);
  });

  it("mais de 100 combinacoes -> TOO_MANY_VARIANTS; 100 passa", () => {
    const n = (k: number, p: string) => Array.from({ length: k }, (_, i) => `${p}${i}`);
    expect(expandVariants(n(10, "c"), n(10, "t"), base, "x")).toHaveLength(100);
    expect(() => expandVariants(n(101, "c"), ["P"], base, "x")).toThrow(expect.objectContaining({ code: "TOO_MANY_VARIANTS" }));
  });

  it("cor/tamanho com mais de 30 caracteres ou sem letra/numero -> erro", () => {
    expect(() => expandVariants(["a".repeat(31)], ["P"], base, "x")).toThrow(VariantsError);
    expect(() => expandVariants(["★"], ["P"], base, "x")).toThrow(VariantsError);
  });
});
