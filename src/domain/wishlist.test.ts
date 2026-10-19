import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { WISHLIST_MAX, WishlistError, addToWishlist, isInWishlist, listWishlist, removeFromWishlist } from "./wishlist";

let tag: string;
let planId: string;
const stores: string[] = [];
let S: string;
let cust: string;

const mkStore = async (k: string) => {
  const s = await prisma.store.create({ data: { slug: `wl-${k}-${tag}`, name: `Loja ${k}`, planId } });
  stores.push(s.id);
  return s.id;
};
async function mkProduct(storeId: string, k: string, o: { active?: boolean; stock?: number; variantActive?: boolean; price?: number } = {}) {
  const p = await prisma.product.create({ data: { storeId, slug: `p-${k}-${tag}`, name: `Prod ${k}`, active: o.active ?? true, weightGrams: 300, heightCm: 5, widthCm: 20, lengthCm: 30 } });
  await prisma.variant.create({ data: { storeId, productId: p.id, sku: `S-${k}-${tag}`, color: "Azul", size: "G", priceCents: o.price ?? 5000, stock: o.stock ?? 5, active: o.variantActive ?? true } });
  return p.id;
}
const mkCustomer = async (storeId: string, k: string) =>
  (await prisma.customer.create({ data: { storeId, name: k, email: `${k}-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } })).id;
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof WishlistError ? e.code : String(e)));

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-Wl" }, update: {},
    create: { name: "Teste-Wl", priceCents: 0, productLimit: 100000, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  S = await mkStore("s");
  cust = await mkCustomer(S, "c");
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Wl" } });
  await prisma.$disconnect();
});

describe("favoritos", () => {
  it("adiciona (idempotente), consulta, remove (idempotente)", async () => {
    const p = await mkProduct(S, "a");
    expect(await isInWishlist(S, cust, p)).toBe(false);
    await addToWishlist(S, cust, p);
    await addToWishlist(S, cust, p);
    expect(await isInWishlist(S, cust, p)).toBe(true);
    expect(await prisma.wishlistItem.count({ where: { customerId: cust } })).toBe(1);
    await removeFromWishlist(S, cust, p);
    await removeFromWishlist(S, cust, p);
    expect(await isInWishlist(S, cust, p)).toBe(false);
  });
  it("produto de outra loja, inexistente ou inativo = 404; favorito de um cliente nao aparece para outro", async () => {
    const foreign = await mkProduct(await mkStore("f"), "f");
    const off = await mkProduct(S, "off", { active: false });
    for (const id of [foreign, off, "nao-existe"]) expect(await code(addToWishlist(S, cust, id)), id).toBe("PRODUCT_NOT_FOUND");
    const p = await mkProduct(S, "a");
    await addToWishlist(S, cust, p);
    const other = await mkCustomer(S, "o");
    expect(await isInWishlist(S, other, p)).toBe(false);
    expect(await listWishlist(S, other)).toEqual([]);
  });
  it("lista do mais recente ao mais antigo, em formato de card; esconde inativo/sem variacao ativa; esgotado vem marcado", async () => {
    const [a, b, c, inactive, noVariant] = [await mkProduct(S, "a", { price: 3000 }), await mkProduct(S, "b", { stock: 0 }), await mkProduct(S, "c", { stock: 1 }),
      await mkProduct(S, "i"), await mkProduct(S, "n", { variantActive: false })];
    for (const id of [a, b, c, inactive, noVariant]) { await addToWishlist(S, cust, id); await new Promise((r) => setTimeout(r, 5)); }
    await prisma.product.update({ where: { id: inactive }, data: { active: false } });
    const items = await listWishlist(S, cust);
    expect(items.map((i) => i.id)).toEqual([c, b, a]);
    expect(items[0]).toMatchObject({ lastUnit: true, soldOut: false });
    expect(items[1]).toMatchObject({ soldOut: true });
    expect(items[2]).toMatchObject({ minPriceCents: 3000, imageUrl: null });
  });
  it("limite de favoritos por cliente; excluir o produto remove o favorito", async () => {
    const p = await mkProduct(S, "a");
    const ids = [p];
    for (let i = 0; i < WISHLIST_MAX - 1; i++) ids.push(await mkProduct(S, `x${i}`));
    for (const id of ids) await addToWishlist(S, cust, id);
    expect(await code(addToWishlist(S, cust, await mkProduct(S, "extra")))).toBe("WISHLIST_FULL");
    await addToWishlist(S, cust, p); // ja favoritado continua idempotente mesmo cheio
    await prisma.variant.deleteMany({ where: { productId: p } });
    await prisma.product.delete({ where: { id: p } });
    expect(await prisma.wishlistItem.count({ where: { customerId: cust } })).toBe(WISHLIST_MAX - 1);
  });
});
