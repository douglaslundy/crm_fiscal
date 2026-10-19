import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { listProducts, parseCatalogFilters } from "./catalog";
import {
  CollectionBody, CollectionError, collectionProductIds, createCollection, deleteCollection, getActiveCollections, getCollectionBySlug,
  listCollections, setCollectionProducts, updateCollection,
} from "./collections";

let tag: string;
let planId: string;
const stores: string[] = [];
let S: string;

const mkStore = async (k: string) => {
  const s = await prisma.store.create({ data: { slug: `col-${k}-${tag}`, name: `Loja ${k}`, planId } });
  stores.push(s.id);
  return s.id;
};
async function mkProduct(storeId: string, k: string, active = true) {
  const p = await prisma.product.create({ data: { storeId, slug: `p-${k}-${tag}`, name: `Prod ${k}`, active, weightGrams: 300, heightCm: 5, widthCm: 20, lengthCm: 30 } });
  await prisma.variant.create({ data: { storeId, productId: p.id, sku: `S-${k}-${tag}`, color: "Azul", size: "G", priceCents: 5000, stock: 5 } });
  return p.id;
}
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof CollectionError ? e.code : String(e)));
const names = async (storeId: string, slug: string) =>
  (await listProducts(storeId, { ...parseCatalogFilters(new URLSearchParams()), collection: slug })).items.map((i) => i.slug).sort();

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-Col" }, update: {},
    create: { name: "Teste-Col", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  S = await mkStore("s");
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Col" } });
  await prisma.$disconnect();
});

describe("colecoes", () => {
  it("cria com slug automatico; slug repetido 409 na loja, livre em outra; slug invalido 400", async () => {
    expect(await createCollection(S, { name: "Verão 2027" })).toMatchObject({ slug: "verao-2027", active: true });
    expect(await code(createCollection(S, { name: "Verão 2027" }))).toBe("COLLECTION_SLUG_TAKEN");
    expect(await code(createCollection(await mkStore("o"), { name: "Verão 2027" }))).toBe("ok");
    expect(await code(createCollection(S, { name: "X", slug: "Slug Ruim!" }))).toBe("COLLECTION_INVALID");
  });
  it("edita, lista com contagem, exclui; outra loja = 404", async () => {
    const c = await createCollection(S, { name: "A" });
    const other = await mkStore("o2");
    expect(await updateCollection(S, c.id, { name: "B", active: false })).toMatchObject({ name: "B", active: false, slug: "a" });
    expect(await code(updateCollection(other, c.id, { name: "Z" }))).toBe("COLLECTION_NOT_FOUND");
    expect(await code(deleteCollection(other, c.id))).toBe("COLLECTION_NOT_FOUND");
    expect(await listCollections(S)).toEqual([{ id: c.id, slug: "a", name: "B", active: false, productCount: 0 }]);
    expect(await code(deleteCollection(S, c.id))).toBe("ok");
    expect(await listCollections(S)).toEqual([]);
  });
  it("define produtos (substitui, idempotente); produto de outra loja ou inexistente = 400 e nada muda", async () => {
    const c = await createCollection(S, { name: "Tema" });
    const [a, b] = [await mkProduct(S, "a"), await mkProduct(S, "b")];
    const foreign = await mkProduct(await mkStore("f"), "f");
    await setCollectionProducts(S, c.id, [a, b, a]);
    expect((await collectionProductIds(S, c.id)).sort()).toEqual([a, b].sort());
    await setCollectionProducts(S, c.id, [b]);
    expect(await collectionProductIds(S, c.id)).toEqual([b]);
    expect(await code(setCollectionProducts(S, c.id, [a, foreign]))).toBe("PRODUCT_NOT_FOUND");
    expect(await collectionProductIds(S, c.id)).toEqual([b]);
    expect(await code(setCollectionProducts(S, "nao-existe", []))).toBe("COLLECTION_NOT_FOUND");
    await setCollectionProducts(S, c.id, []);
    expect(await collectionProductIds(S, c.id)).toEqual([]);
  });
  it("excluir a colecao ou o produto nao apaga o outro lado", async () => {
    const c = await createCollection(S, { name: "Tema" });
    const p = await mkProduct(S, "a");
    await setCollectionProducts(S, c.id, [p]);
    await prisma.product.delete({ where: { id: p } });
    expect(await collectionProductIds(S, c.id)).toEqual([]);
    const p2 = await mkProduct(S, "b");
    await setCollectionProducts(S, c.id, [p2]);
    await deleteCollection(S, c.id);
    expect(await prisma.product.count({ where: { id: p2 } })).toBe(1);
  });
});

describe("vitrine", () => {
  it("filtra produtos da colecao (so ativos); colecao inativa ou inexistente = vazio; isolamento por loja", async () => {
    const c = await createCollection(S, { name: "Tema" });
    const [a, off, out] = [await mkProduct(S, "a"), await mkProduct(S, "off", false), await mkProduct(S, "out")];
    await setCollectionProducts(S, c.id, [a, off]);
    expect(await names(S, "tema")).toEqual([`p-a-${tag}`]);
    expect(out).toBeTruthy();
    expect(await names(S, "nao-existe")).toEqual([]);
    expect(await names(await mkStore("v"), "tema")).toEqual([]);
    await updateCollection(S, c.id, { active: false });
    expect(await names(S, "tema")).toEqual([]);
    expect(await getCollectionBySlug(S, "tema")).toBeNull();
  });
  it("menu: so colecoes ativas com produtos", async () => {
    const [full, empty, off] = [await createCollection(S, { name: "Cheia" }), await createCollection(S, { name: "Vazia" }), await createCollection(S, { name: "Inativa", active: false })];
    const p = await mkProduct(S, "a");
    await setCollectionProducts(S, full.id, [p]);
    await setCollectionProducts(S, off.id, [p]);
    expect(empty.id).toBeTruthy();
    expect((await getActiveCollections(S)).map((c) => c.slug)).toEqual(["cheia"]);
  });
});

describe("schema", () => {
  it("nome 1-60, slug vazio = automatico", () => {
    expect(CollectionBody.parse({ name: " X ", slug: "" })).toEqual({ name: "X", slug: undefined });
    for (const bad of [{ name: "" }, { name: "x".repeat(61) }, {}]) expect(CollectionBody.safeParse(bad).success).toBe(false);
  });
});
