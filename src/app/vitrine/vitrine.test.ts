import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { prisma } from "@/lib/db";
import { dbForStore } from "@/lib/db-store";
import { STORE_HOST_HEADER } from "@/lib/host";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
const nextHeaders = await import("next/headers");
const { default: Home } = await import("./page");
const { default: ProductPage, generateMetadata: productMeta } = await import("./p/[slug]/page");
const { default: CategoryPage, generateMetadata: categoryMeta } = await import("./c/[slug]/page");
const { default: SearchPage } = await import("./buscar/page");

let tag: string;
let planId: string;
const storeIds: string[] = [];
const stores: Record<"a" | "b", { id: string; slug: string }> = {} as never;

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.create({ data: { name: `T12v-${tag}`, priceCents: 1, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false } })).id;
  for (const k of ["a", "b"] as const) {
    const s = await prisma.store.create({ data: { slug: `t12v-${k}-${tag}`, name: `Loja ${k}`, planId } });
    storeIds.push(s.id);
    stores[k] = s;
  }
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: storeIds.splice(0) } } });
  await prisma.plan.deleteMany({ where: { id: planId } });
});
afterAll(() => prisma.$disconnect());

const asStore = (slug: string | null) =>
  vi.mocked(nextHeaders.headers).mockResolvedValue(new Headers(slug ? { [STORE_HOST_HEADER]: `${slug}.localhost` } : {}) as never);
async function product(storeId: string, name: string, slug: string, stock = 3) {
  const db = dbForStore(storeId);
  const p = await db.product.create({ data: { storeId, name, slug, description: "Desc", weightGrams: 1, heightCm: 1, widthCm: 1, lengthCm: 1 } });
  await db.variant.create({ data: { storeId, productId: p.id, sku: `${p.id}-1`, color: "Azul", size: "M", priceCents: 27000, stock } });
  return p;
}
const html = async (el: Promise<ReactElement>) => renderToStaticMarkup(await el);
const NOT_FOUND = { digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404") };
const params = (slug: string) => ({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });

describe("metadata", () => {
  it("produto e categoria: titulo com a loja e descricao; inexistente, de outra loja ou loja fechada -> vazio", async () => {
    await product(stores.a.id, "Camisa Linho", "camisa-linho");
    await product(stores.b.id, "Alheio", "alheio");
    await dbForStore(stores.a.id).category.create({ data: { storeId: stores.a.id, name: "Camisas", slug: "camisas" } });
    asStore(stores.a.slug);
    expect(await productMeta(params("camisa-linho"))).toEqual({ title: "Camisa Linho | Loja a", description: "Desc" });
    expect(await categoryMeta(params("camisas"))).toEqual({ title: "Camisas | Loja a", description: "Camisas na Loja a" });
    expect(await productMeta(params("alheio"))).toEqual({});
    expect(await categoryMeta(params("nao-existe"))).toEqual({});
    await prisma.store.update({ where: { id: stores.a.id }, data: { status: "SUSPENDED" } });
    expect(await productMeta(params("camisa-linho"))).toEqual({});
  });
});

describe("vitrine", () => {
  it("produto de outra loja pelo slug -> 404; da propria loja renderiza com JSON-LD escapado", async () => {
    await product(stores.b.id, "Alheio", "alheio");
    await product(stores.a.id, "Camisa </script><script>alert(1)</script>", "camisa", 1);
    asStore(stores.a.slug);
    await expect(ProductPage(params("alheio"))).rejects.toMatchObject(NOT_FOUND);
    await expect(ProductPage(params("nao-existe"))).rejects.toMatchObject(NOT_FOUND);
    const page = await html(ProductPage(params("camisa")));
    expect(page).toContain('type="application/ld+json"');
    expect(page.match(/<script/g)).toHaveLength(1);
    expect(page).toContain("\\u003c/script\\u003e");
    expect(page).toContain("3x de");
  });
  it("host da plataforma (sem header de loja) -> 404 em todas as paginas da vitrine", async () => {
    asStore(null);
    await expect(Home({ searchParams: Promise.resolve({}) })).rejects.toMatchObject(NOT_FOUND);
    await expect(ProductPage(params("x"))).rejects.toMatchObject(NOT_FOUND);
    await expect(CategoryPage(params("x"))).rejects.toMatchObject(NOT_FOUND);
    await expect(SearchPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject(NOT_FOUND);
  });
  it("loja suspensa/cancelada: aviso e nenhum produto; ativa lista", async () => {
    await product(stores.a.id, "Produto Visivel", "visivel");
    asStore(stores.a.slug);
    expect(await html(Home({ searchParams: Promise.resolve({}) }))).toContain("Produto Visivel");
    expect(await html(SearchPage({ searchParams: Promise.resolve({ q: "visivel" }) }))).toContain("Produto Visivel");
    for (const status of ["SUSPENDED", "CANCELED"] as const) {
      await prisma.store.update({ where: { id: stores.a.id }, data: { status } });
      for (const page of [
        await html(Home({ searchParams: Promise.resolve({}) })),
        await html(SearchPage({ searchParams: Promise.resolve({}) })),
        await html(CategoryPage(params("x"))),
        await html(ProductPage(params("visivel"))),
      ]) {
        expect(page).toContain("Loja indisponível no momento");
        expect(page).not.toContain("Produto Visivel");
        expect(page).not.toContain("carrinho");
      }
    }
  });
  it("categoria desconhecida -> 404; categoria existente lista os produtos dela", async () => {
    const c = await dbForStore(stores.a.id).category.create({ data: { storeId: stores.a.id, name: "Camisetas", slug: "camisetas" } });
    const p = await product(stores.a.id, "Na Categoria", "na-cat");
    await dbForStore(stores.a.id).product.update({ where: { id: p.id }, data: { categoryId: c.id } });
    await product(stores.a.id, "Fora", "fora");
    asStore(stores.a.slug);
    await expect(CategoryPage(params("nao-existe"))).rejects.toMatchObject(NOT_FOUND);
    const page = await html(CategoryPage(params("camisetas")));
    expect(page).toContain("Na Categoria");
    expect(page).not.toContain("Fora");
  });
});
