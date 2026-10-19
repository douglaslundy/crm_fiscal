import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dbForStore } from "@/lib/db-store";
import { MAX_PAGE, PAGE_SIZE, getProductBySlug, isStoreOpen, jsonLdScript, listProducts, parseCatalogFilters, productJsonLd } from "./catalog";

const sp = (q: string) => parseCatalogFilters(new URLSearchParams(q));

describe("parseCatalogFilters", () => {
  it("tamanhos repetidos, preco minimo e pagina padrao", () => {
    expect(sp("size=M&size=G&min=5000")).toEqual({ sizes: ["M", "G"], colors: [], minCents: 5000, page: 1 });
  });
  it("pagina invalida -> 1; min negativo/nao numerico ignorado", () => {
    expect(sp("page=abc").page).toBe(1);
    expect(sp("page=0").page).toBe(1);
    expect(sp("page=-3").page).toBe(1);
    expect(sp("page=2.5").page).toBe(1);
    expect(sp("page=3").page).toBe(3);
    expect(sp("page=999999999").page).toBe(MAX_PAGE); // numero absurdo e limitado
    expect(sp("min=-5").minCents).toBeUndefined();
    expect(sp("min=abc&max=1e3").minCents).toBeUndefined();
    expect(sp("max=1e3").maxCents).toBeUndefined();
    expect(sp("min=&max=").maxCents).toBeUndefined();
  });
  it("min > max ignora max; categoria, cores e busca", () => {
    expect(sp("min=5000&max=100")).toEqual({ sizes: [], colors: [], minCents: 5000, page: 1 });
    expect(sp("min=100&max=5000")).toMatchObject({ minCents: 100, maxCents: 5000 });
    expect(sp("category=camisetas&color=Preto&color=azul&size=")).toMatchObject({ category: "camisetas", colors: ["Preto", "azul"], sizes: [] });
  });
  it("q aparado, limitado a 80, vazio -> undefined", () => {
    expect(sp("q=%20%20camisa%20").q).toBe("camisa");
    expect(sp("q=%20%20").q).toBeUndefined();
    expect(sp(`q=${"a".repeat(200)}`).q).toHaveLength(80);
  });
});

let tag: string;
let planId: string;
let a: string;
let b: string;
const storeIds: string[] = [];

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.create({ data: { name: `T12-${tag}`, priceCents: 1, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false } })).id;
  const mk = async (k: string) => {
    const s = await prisma.store.create({ data: { slug: `t12-${k}-${tag}`, name: k, planId } });
    storeIds.push(s.id);
    return s.id;
  };
  a = await mk("a");
  b = await mk("b");
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: storeIds.splice(0) } } });
  await prisma.plan.deleteMany({ where: { id: planId } });
});
afterAll(() => prisma.$disconnect());

type V = { color?: string; size?: string; priceCents?: number; stock?: number; active?: boolean };
let seq = 0;
async function product(storeId: string, name: string, variants: V[], extra: { active?: boolean; categoryId?: string; createdAt?: Date; images?: string[] } = {}) {
  const db = dbForStore(storeId);
  const p = await db.product.create({
    data: {
      storeId, name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${++seq}`, active: extra.active ?? true, categoryId: extra.categoryId ?? null,
      weightGrams: 300, heightCm: 4, widthCm: 25, lengthCm: 30, ...(extra.createdAt && { createdAt: extra.createdAt }),
    },
  });
  if (variants.length) {
    await db.variant.createMany({
      data: variants.map((v, i) => ({ storeId, productId: p.id, sku: `${p.id}-${i}`, color: v.color ?? "Preto", size: v.size ?? `T${i}`, priceCents: v.priceCents ?? 5000, stock: v.stock ?? 5, active: v.active ?? true })),
    });
  }
  for (const [position, url] of (extra.images ?? []).entries()) await db.productImage.create({ data: { storeId, productId: p.id, url, position } });
  return p;
}
const cat = (storeId: string, slug: string, parentId: string | null = null) =>
  dbForStore(storeId).category.create({ data: { storeId, name: slug, slug, parentId } });
const names = async (storeId: string, q: string) => (await listProducts(storeId, sp(q))).items.map((i) => i.name);

describe("listProducts (vitrine)", () => {
  it("so produtos ativos com variacao ativa; isolado por loja; card com menor preco ativo e primeira imagem", async () => {
    await product(a, "Visivel", [{ priceCents: 9000 }, { priceCents: 4000, active: false }, { priceCents: 7000 }], { images: ["https://img/2", "https://img/1"] });
    await product(a, "Inativo", [{}], { active: false });
    await product(a, "SemVariacaoAtiva", [{ active: false }]);
    await product(a, "SemVariacao", []);
    await product(b, "DeOutraLoja", [{}]);
    const r = await listProducts(a, sp(""));
    expect(r.total).toBe(1);
    expect(r.items).toEqual([{ id: expect.any(String), slug: expect.stringMatching(/^visivel-/), name: "Visivel", imageUrl: "https://img/2", minPriceCents: 7000, soldOut: false, lastUnit: false }]);
    expect(await names(b, "")).toEqual(["DeOutraLoja"]);
  });
  it("esgotado continua listado; ultima peca quando estoque total ativo == 1", async () => {
    await product(a, "Esgotado", [{ stock: 0 }, { stock: 0 }, { stock: 9, active: false }]);
    await product(a, "Ultima", [{ stock: 1 }, { stock: 0 }]);
    const r = await listProducts(a, sp(""));
    expect(r.items.find((i) => i.name === "Esgotado")).toMatchObject({ soldOut: true, lastUnit: false, imageUrl: null });
    expect(r.items.find((i) => i.name === "Ultima")).toMatchObject({ soldOut: false, lastUnit: true });
  });
  it("categoria inclui descendentes; categoria desconhecida ou de outra loja -> vazio", async () => {
    const root = await cat(a, "roupas");
    const sub = await cat(a, "camisetas", root.id);
    const subsub = await cat(a, "regatas", sub.id);
    const other = await cat(a, "calcados");
    await cat(b, "sapatos");
    await product(a, "Raiz", [{}], { categoryId: root.id });
    await product(a, "Sub", [{}], { categoryId: sub.id });
    await product(a, "SubSub", [{}], { categoryId: subsub.id });
    await product(a, "Tenis", [{}], { categoryId: other.id });
    await product(a, "SemCategoria", [{}]);
    expect((await names(a, "category=roupas")).sort()).toEqual(["Raiz", "Sub", "SubSub"]);
    expect((await names(a, "category=camisetas")).sort()).toEqual(["Sub", "SubSub"]);
    expect(await listProducts(a, sp("category=nao-existe"))).toEqual({ items: [], total: 0, page: 1 });
    expect(await listProducts(a, sp("category=sapatos"))).toEqual({ items: [], total: 0, page: 1 });
  });
  it("tamanho/cor sem diferenciar maiusculas, so em variacao ativa; faixa de preco; busca no nome", async () => {
    await product(a, "Camisa Azul", [{ color: "Azul", size: "M", priceCents: 5000 }, { color: "Preto", size: "GG", priceCents: 20000, active: false }]);
    await product(a, "Camisa Preta", [{ color: "Preto", size: "G", priceCents: 12000 }]);
    expect(await names(a, "size=m")).toEqual(["Camisa Azul"]);
    expect(await names(a, "size=gg")).toEqual([]);
    expect((await names(a, "size=M&size=g")).sort()).toEqual(["Camisa Azul", "Camisa Preta"]);
    expect(await names(a, "color=PRETO")).toEqual(["Camisa Preta"]);
    expect(await names(a, "min=10000")).toEqual(["Camisa Preta"]);
    expect(await names(a, "max=6000")).toEqual(["Camisa Azul"]);
    expect(await names(a, "min=13000")).toEqual([]);
    expect(await names(a, "q=AZUL")).toEqual(["Camisa Azul"]);
  });
  it("mais novos primeiro, 24 por pagina, total do filtro", async () => {
    const t0 = Date.now() - 100_000;
    for (let i = 0; i < PAGE_SIZE + 2; i++) await product(a, `P${i}`, [{}], { createdAt: new Date(t0 + i * 1000) });
    await product(a, "Fora", [{}], { active: false });
    const p1 = await listProducts(a, sp(""));
    expect(PAGE_SIZE).toBe(24);
    expect(p1.total).toBe(PAGE_SIZE + 2);
    expect(p1.items).toHaveLength(24);
    expect(p1.items[0].name).toBe(`P${PAGE_SIZE + 1}`);
    const p2 = await listProducts(a, sp("page=2"));
    expect(p2.items.map((i) => i.name)).toEqual(["P1", "P0"]);
    expect(p2.total).toBe(PAGE_SIZE + 2);
    expect(p2.page).toBe(2);
    const past = await listProducts(a, sp("page=50")); // alem do fim: mostra a ultima pagina
    expect(past).toMatchObject({ page: 2, total: PAGE_SIZE + 2 });
    expect(past.items.map((i) => i.name)).toEqual(["P1", "P0"]);
    expect(await listProducts(a, sp("page=3&q=nada-casa"))).toMatchObject({ page: 1, total: 0, items: [] });
  });
});

describe("getProductBySlug", () => {
  it("produto ativo da loja com variacoes ativas e imagens; outra loja / inativo / sem variacao ativa -> null", async () => {
    const pa = await product(a, "Camisa", [{ color: "Azul", size: "M" }, { color: "Azul", size: "G", active: false }], { images: ["https://img/x"] });
    const pb = await product(b, "Alheio", [{}]);
    const off = await product(a, "Off", [{}], { active: false });
    const noVar = await product(a, "NoVar", [{ active: false }]);
    const got = await getProductBySlug(a, pa.slug);
    expect(got?.id).toBe(pa.id);
    expect(got?.variants.map((v) => v.size)).toEqual(["M"]);
    expect(got?.images.map((i) => i.url)).toEqual(["https://img/x"]);
    expect(await getProductBySlug(a, pb.slug)).toBeNull();
    expect(await getProductBySlug(a, off.slug)).toBeNull();
    expect(await getProductBySlug(a, noVar.slug)).toBeNull();
    expect(await getProductBySlug(a, "nao-existe")).toBeNull();
  });
});

describe("isStoreOpen", () => {
  it("TRIAL/ACTIVE abertas; SUSPENDED/CANCELED fechadas", () => {
    expect(["TRIAL", "ACTIVE", "SUSPENDED", "CANCELED"].map((status) => isStoreOpen({ status } as never))).toEqual([true, true, false, false]);
  });
});

describe("JSON-LD", () => {
  it("escapa < > & e U+2028/2029: nome nao fecha a tag script", () => {
    const name = `</script><script>alert(1)</script> & ${String.fromCharCode(0x2028, 0x2029)}`;
    const s = jsonLdScript({ name });
    expect(s).not.toMatch(new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`));
    expect(JSON.parse(s)).toEqual({ name });
  });
  it("Product com oferta em BRL e disponibilidade", () => {
    const ld = productJsonLd({ name: "Camisa", description: "Algodao", images: [{ url: "https://img/1" }], variants: [{ priceCents: 8990, stock: 0 }, { priceCents: 12000, stock: 2 }] });
    expect(ld).toEqual({
      "@context": "https://schema.org", "@type": "Product", name: "Camisa", image: ["https://img/1"], description: "Algodao",
      offers: { "@type": "Offer", priceCurrency: "BRL", price: "89.90", availability: "https://schema.org/InStock" },
    });
    expect(productJsonLd({ name: "X", description: "", images: [], variants: [{ priceCents: 100, stock: 0 }] }).offers.availability).toBe("https://schema.org/OutOfStock");
  });
});
