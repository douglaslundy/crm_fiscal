import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { dbForStore } from "@/lib/db-store";
import { MemoryStorage } from "../../tests/fake-storage";

const storage = new MemoryStorage();
vi.mock("@/integrations/storage", async (orig) => ({ ...(await orig<typeof import("@/integrations/storage")>()), getStorage: () => storage }));
const { ProductError, createProduct, deleteProduct, getProduct, listProducts, parseProductQuery, updateProduct } = await import("./products");
const { addVariant, deleteVariant, updateVariant } = await import("./productVariants");
const { PlanLimitError } = await import("./entitlements");

let tag: string;
let planId: string;
let a: string;
let b: string;
let catA: string;
let catB: string;
const storeIds: string[] = [];

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.create({ data: { name: `T10p-${tag}`, priceCents: 1, productLimit: 5, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false } })).id;
  const mk = async (k: string) => {
    const s = await prisma.store.create({ data: { slug: `t10p-${k}-${tag}`, name: k, planId } });
    storeIds.push(s.id);
    return s.id;
  };
  a = await mk("a");
  b = await mk("b");
  catA = (await dbForStore(a).category.create({ data: { storeId: a, name: "Camisetas", slug: "camisetas" } })).id;
  catB = (await dbForStore(b).category.create({ data: { storeId: b, name: "Camisetas", slug: "camisetas" } })).id;
  storage.removed.length = 0;
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: storeIds.splice(0) } } }); // cascata leva produtos, pedidos e categorias
  await prisma.plan.deleteMany({ where: { id: planId } });
});
afterAll(() => prisma.$disconnect());

const variant = (color: string, size: string, extra = {}) => ({ color, size, sku: `${color}-${size}`.toLowerCase(), priceCents: 4990, stock: 2, ...extra });
const input = (storeCat: string, extra: Record<string, unknown> = {}) => ({
  name: "Camiseta Básica", description: "Algodão", categoryId: storeCat, active: true,
  weightGrams: 300, heightCm: 4, widthCm: 25, lengthCm: 30,
  variants: [variant("Preto", "P"), variant("Preto", "M")], images: [] as { url: string; color?: string | null }[], ...extra,
});
const fail = (p: Promise<unknown>) => p.then(() => { throw new Error("deveria falhar"); }, (e) => e);
const code = async (p: Promise<unknown>) => { const e = await fail(p); return e instanceof ProductError ? `${e.status} ${e.code}` : e; };
const img = async (storeId: string) => (await storage.put({ storeId, bytes: new Uint8Array([1]), contentType: "image/png" })).url;
async function order(storeId: string, variantId: string) {
  const db = dbForStore(storeId);
  const c = await db.customer.create({ data: { storeId, name: "C", email: `c-${Math.random()}@t.local`, cpf: "1", phone: "1", passwordHash: "x" } });
  const o = await db.order.create({ data: { storeId, customerId: c.id, subtotalCents: 1, shippingCents: 0, totalCents: 1, shippingService: "PAC", addressSnapshot: {} } });
  await db.orderItem.create({ data: { storeId, orderId: o.id, variantId, productName: "x", sku: "x", color: "x", size: "x", unitPriceCents: 1, quantity: 1 } });
}

describe("createProduct", () => {
  it("cria produto, variacoes e imagens juntos; slug do nome", async () => {
    const url = await img(a);
    const p = await createProduct(a, input(catA, { images: [{ url, color: "preto" }] }));
    expect(p).toMatchObject({ slug: "camiseta-basica", name: "Camiseta Básica", categoryId: catA, active: true, storeId: a });
    expect(p.variants.map((v) => v.sku).sort()).toEqual(["preto-m", "preto-p"]);
    expect(p.images).toEqual([expect.objectContaining({ url, color: "Preto", position: 0 })]);
  });

  it("slug unico por loja (409), o mesmo slug em outra loja pode; sem sufixo automatico", async () => {
    await createProduct(a, input(catA));
    expect(await code(createProduct(a, input(catA, { variants: [variant("Azul", "P", { sku: "outro" })] })))).toBe("409 SLUG_TAKEN");
    expect((await createProduct(b, input(catB))).slug).toBe("camiseta-basica");
    expect(await code(createProduct(a, input(catA, { name: "!!!" })))).toBe("400 SLUG_INVALID");
  });

  it("SKU unico por loja (409 SKU_TAKEN), mas o mesmo SKU em outra loja pode", async () => {
    await createProduct(a, input(catA));
    expect(await code(createProduct(a, input(catA, { name: "Outra" })))).toBe("409 SKU_TAKEN");
    await expect(createProduct(b, input(catB, { name: "Outra" }))).resolves.toBeDefined();
    expect(await code(createProduct(a, input(catA, { name: "Dup", variants: [variant("Azul", "P"), variant("Verde", "P", { sku: "azul-p" })] })))).toBe("409 SKU_TAKEN");
    expect(await code(createProduct(a, input(catA, { name: "Dup", variants: [variant("Azul", "P"), variant("azul", "p", { sku: "z" })] })))).toBe("409 VARIANT_EXISTS");
  });

  it("tudo ou nada: insercao de variacao falhando nao deixa produto nem imagem", async () => {
    await createProduct(a, input(catA, { name: "Primeiro" }));
    const url = await img(a);
    expect(await code(createProduct(a, input(catA, { name: "Segundo", images: [{ url }] })))).toBe("409 SKU_TAKEN");
    expect(await prisma.product.count({ where: { storeId: a, name: "Segundo" } })).toBe(0);
    expect(await prisma.productImage.count({ where: { storeId: a } })).toBe(0);
  });

  it("categoria obrigatoria e da mesma loja", async () => {
    expect(await code(createProduct(a, input(catB)))).toBe("400 CATEGORY_INVALID");
    expect(await code(createProduct(a, input("nao-existe")))).toBe("400 CATEGORY_INVALID");
    expect((await fail(createProduct(a, input("")))).name).toBe("ZodError");
    expect(await prisma.product.count({ where: { storeId: a } })).toBe(0);
  });

  it("produto ativo exige variacao ativa; inativo sem variacao pode", async () => {
    expect(await code(createProduct(a, input(catA, { variants: [] })))).toBe("400 NO_ACTIVE_VARIANT");
    expect(await code(createProduct(a, input(catA, { variants: [variant("A", "P", { active: false })] })))).toBe("400 NO_ACTIVE_VARIANT");
    expect((await createProduct(a, input(catA, { active: false, variants: [] }))).active).toBe(false);
  });

  it.each([
    ["nome vazio", { name: "  " }], ["nome longo", { name: "n".repeat(121) }], ["descricao longa", { description: "d".repeat(5001) }],
    ["peso 0", { weightGrams: 0 }], ["peso acima", { weightGrams: 30001 }], ["peso fracionado", { weightGrams: 1.5 }],
    ["altura 0", { heightCm: 0 }], ["largura 106", { widthCm: 106 }], ["comprimento texto", { lengthCm: "10" }],
    ["preco 0", { variants: [variant("A", "P", { priceCents: 0 })] }], ["preco fracionado", { variants: [variant("A", "P", { priceCents: 9.9 })] }],
    ["estoque negativo", { variants: [variant("A", "P", { stock: -1 })] }], ["cor longa", { variants: [variant("c".repeat(31), "P", { sku: "x" })] }],
    ["tamanho vazio", { variants: [variant("A", " ", { sku: "x" })] }], ["sku vazio", { variants: [variant("A", "P", { sku: "" })] }],
    ["sku com espaco", { variants: [variant("A", "P", { sku: "a b" })] }],
  ])("validacao: %s -> erro de validacao (400 na rota)", async (_l, extra) => {
    expect((await fail(createProduct(a, input(catA, extra)))).name).toBe("ZodError");
  });

  it("limite do plano: inativos contam; N criacoes simultaneas no limite-1 -> so uma passa", async () => {
    for (let i = 0; i < 4; i++) await createProduct(a, input(catA, { name: `P${i}`, active: false, variants: [] }));
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) =>
      createProduct(a, input(catA, { name: `Corrida ${i}`, variants: [variant("C", `${i}`, { sku: `corrida-${i}` })] }))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r): r is PromiseRejectedResult => r.status === "rejected")) {
      expect(r.reason).toBeInstanceOf(PlanLimitError);
      expect(r.reason).toMatchObject({ code: "PRODUCT_LIMIT", limit: 5 });
    }
    expect(await prisma.product.count({ where: { storeId: a } })).toBe(5);
    expect(await prisma.variant.count({ where: { storeId: a } })).toBe(1);
  });
});

describe("imagens", () => {
  it("URL tem de ser emitida para ESTA loja; de outra loja ou externa -> 400 IMAGE_URL_INVALID", async () => {
    const urlB = await img(b);
    for (const url of [urlB, "https://evil.example/x.png", `https://fake.test/stores/${a}/../${b}/x.png`, `https://fake.test/stores/${a}/x.svg`]) {
      expect(await code(createProduct(a, input(catA, { images: [{ url }] })))).toBe("400 IMAGE_URL_INVALID");
    }
  });
  it("no maximo 10 por produto", async () => {
    const urls = await Promise.all(Array.from({ length: 11 }, () => img(a)));
    expect((await fail(createProduct(a, input(catA, { images: urls.map((url) => ({ url })) })))).name).toBe("ZodError");
    const p = await createProduct(a, input(catA, { images: urls.slice(0, 10).map((url) => ({ url })) }));
    expect(p.images.map((i) => i.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("cor da imagem tem de ser cor de uma variacao (sem diferenciar maiusculas)", async () => {
    expect(await code(createProduct(a, input(catA, { images: [{ url: await img(a), color: "Roxo" }] })))).toBe("400 IMAGE_COLOR_INVALID");
    const p = await createProduct(a, input(catA, { images: [{ url: await img(a), color: "" }] }));
    expect(p.images[0].color).toBeNull();
  });
  it("PATCH troca o conjunto, renumera posicoes e remove do armazenamento as que sairam", async () => {
    const [u1, u2, u3] = [await img(a), await img(a), await img(a)];
    const p = await createProduct(a, input(catA, { images: [{ url: u1 }, { url: u2 }] }));
    const up = await updateProduct(a, p.id, { images: [{ url: u3, color: "PRETO" }, { url: u1 }] });
    expect(up.images.map((i) => [i.url, i.position, i.color])).toEqual([[u3, 0, "Preto"], [u1, 1, null]]);
    expect(storage.removed).toEqual([u2]);
    expect(await code(updateProduct(a, p.id, { images: [{ url: u1, color: "Roxo" }] }))).toBe("400 IMAGE_COLOR_INVALID");
  });
});

describe("updateProduct", () => {
  it("atualiza campos e recalcula o slug ao renomear", async () => {
    const p = await createProduct(a, input(catA));
    const cat2 = (await dbForStore(a).category.create({ data: { storeId: a, name: "Novas", slug: "novas" } })).id;
    const up = await updateProduct(a, p.id, { name: "Camiseta Nova", categoryId: cat2, weightGrams: 500 });
    expect(up).toMatchObject({ name: "Camiseta Nova", slug: "camiseta-nova", categoryId: cat2, weightGrams: 500 });
  });
  it("produto/categoria de outra loja -> 404/400; slug repetido 409", async () => {
    const pa = await createProduct(a, input(catA));
    const pb = await createProduct(b, input(catB));
    expect(await code(updateProduct(a, pb.id, { name: "Hack" }))).toBe("404 PRODUCT_NOT_FOUND");
    expect(await code(updateProduct(a, pa.id, { categoryId: catB }))).toBe("400 CATEGORY_INVALID");
    await createProduct(a, input(catA, { name: "Outra", variants: [variant("X", "P")] }));
    expect(await code(updateProduct(a, pa.id, { name: "Outra" }))).toBe("409 SLUG_TAKEN");
    expect(await prisma.product.findUniqueOrThrow({ where: { id: pb.id } })).toMatchObject({ name: "Camiseta Básica" });
  });
  it("ativar sem variacao ativa -> 400 NO_ACTIVE_VARIANT", async () => {
    const p = await createProduct(a, input(catA, { active: false, variants: [variant("A", "P", { active: false })] }));
    expect(await code(updateProduct(a, p.id, { active: true }))).toBe("400 NO_ACTIVE_VARIANT");
  });
});

describe("variacoes", () => {
  it("adiciona, edita e apaga; SKU/combinacao repetidos 409", async () => {
    const p = await createProduct(a, input(catA));
    const v = await addVariant(a, p.id, variant("Branco", "G"));
    expect(v).toMatchObject({ productId: p.id, sku: "branco-g", active: true });
    expect(await code(addVariant(a, p.id, variant("Azul", "G", { sku: "branco-g" })))).toBe("409 SKU_TAKEN");
    expect(await code(addVariant(a, p.id, variant("branco", "g", { sku: "nova" })))).toBe("409 VARIANT_EXISTS");
    expect(await updateVariant(a, p.id, v.id, { priceCents: 100, stock: 9 })).toMatchObject({ priceCents: 100, stock: 9 });
    expect(await code(updateVariant(a, p.id, v.id, { sku: "preto-p" }))).toBe("409 SKU_TAKEN");
    expect(await code(updateVariant(a, p.id, v.id, { color: "Preto", size: "P" }))).toBe("409 VARIANT_EXISTS");
    expect((await fail(updateVariant(a, p.id, v.id, { stock: -1 }))).name).toBe("ZodError");
    await deleteVariant(a, p.id, v.id);
    expect(await prisma.variant.count({ where: { id: v.id } })).toBe(0);
  });
  it("ids de outra loja ou de outro produto -> 404", async () => {
    const pa = await createProduct(a, input(catA));
    const pa2 = await createProduct(a, input(catA, { name: "Dois", variants: [variant("Z", "P")] }));
    const pb = await createProduct(b, input(catB));
    const vb = pb.variants[0].id;
    expect(await code(addVariant(a, pb.id, variant("Q", "P")))).toBe("404 PRODUCT_NOT_FOUND");
    expect(await code(updateVariant(a, pb.id, vb, { stock: 1 }))).toBe("404 VARIANT_NOT_FOUND");
    expect(await code(updateVariant(a, pa.id, vb, { stock: 1 }))).toBe("404 VARIANT_NOT_FOUND");
    expect(await code(updateVariant(a, pa.id, pa2.variants[0].id, { stock: 1 }))).toBe("404 VARIANT_NOT_FOUND");
    expect(await code(deleteVariant(a, pa.id, vb))).toBe("404 VARIANT_NOT_FOUND");
    expect(await prisma.variant.findUniqueOrThrow({ where: { id: vb } })).toMatchObject({ stock: 2 });
  });
  it("ultima variacao ativa de produto ativo nao pode ser desativada nem apagada (400 LAST_ACTIVE_VARIANT)", async () => {
    const p = await createProduct(a, input(catA));
    const [v1, v2] = p.variants;
    await updateVariant(a, p.id, v1.id, { active: false });
    expect(await code(updateVariant(a, p.id, v2.id, { active: false }))).toBe("400 LAST_ACTIVE_VARIANT");
    expect(await code(deleteVariant(a, p.id, v2.id))).toBe("400 LAST_ACTIVE_VARIANT");
    await deleteVariant(a, p.id, v1.id); // inativa pode sair
    await updateProduct(a, p.id, { active: false });
    await updateVariant(a, p.id, v2.id, { active: false }); // produto inativo: pode
  });
  it("mais de 100 variacoes por produto -> 400 TOO_MANY_VARIANTS", async () => {
    const vs = Array.from({ length: 100 }, (_, i) => variant("C", `${i}`, { sku: `s-${i}` }));
    const p = await createProduct(a, input(catA, { variants: vs }));
    expect(await code(addVariant(a, p.id, variant("D", "P")))).toBe("400 TOO_MANY_VARIANTS");
  });
});

describe("exclusao com historico de pedidos", () => {
  it("variacao com pedido -> 409 VARIANT_HAS_ORDERS; desativar continua possivel", async () => {
    const p = await createProduct(a, input(catA));
    await order(a, p.variants[0].id);
    expect(await code(deleteVariant(a, p.id, p.variants[0].id))).toBe("409 VARIANT_HAS_ORDERS");
    await expect(updateVariant(a, p.id, p.variants[0].id, { active: false })).resolves.toMatchObject({ active: false });
  });
  it("produto com pedido -> 409 PRODUCT_HAS_ORDERS; sem pedido apaga em cascata e remove imagens", async () => {
    const url = await img(a);
    const p = await createProduct(a, input(catA, { images: [{ url }] }));
    await order(a, p.variants[1].id);
    expect(await code(deleteProduct(a, p.id))).toBe("409 PRODUCT_HAS_ORDERS");
    expect(await prisma.variant.count({ where: { productId: p.id } })).toBe(2);
    const q = await createProduct(a, input(catA, { name: "Livre", variants: [variant("L", "P")], images: [{ url: await img(a) }] }));
    await deleteProduct(a, q.id);
    expect(await prisma.product.count({ where: { id: q.id } })).toBe(0);
    expect(await prisma.variant.count({ where: { productId: q.id } })).toBe(0);
    expect(await prisma.productImage.count({ where: { productId: q.id } })).toBe(0);
    expect(storage.removed).toEqual([q.images[0].url]);
    expect(await code(deleteProduct(b, p.id))).toBe("404 PRODUCT_NOT_FOUND");
  });
});

describe("listProducts e getProduct", () => {
  it("pagina (25), busca por nome/SKU, filtra categoria e ativo, so a loja", async () => {
    const cat2 = (await dbForStore(a).category.create({ data: { storeId: a, name: "Outra", slug: "outra" } })).id;
    await prisma.plan.update({ where: { id: planId }, data: { productLimit: null } });
    for (let i = 0; i < 26; i++) await createProduct(a, input(catA, { name: `Item ${i}`, active: false, variants: [] }));
    await createProduct(a, input(cat2, { name: "Calça Jeans", variants: [variant("Azul", "40", { sku: "JEANS-AZ-40" })] }));
    await createProduct(b, input(catB, { name: "Calça Jeans" }));
    const p1 = await listProducts(a, {});
    expect(p1).toMatchObject({ total: 27, page: 1, pageSize: 25 });
    expect(p1.items).toHaveLength(25);
    expect((await listProducts(a, { page: 2 })).items).toHaveLength(2);
    expect((await listProducts(a, { q: "calça" })).items.map((p) => p.name)).toEqual(["Calça Jeans"]);
    expect((await listProducts(a, { q: "jeans-az" })).total).toBe(1);
    expect((await listProducts(a, { categoryId: cat2 })).total).toBe(1);
    expect((await listProducts(a, { categoryId: catB })).total).toBe(0);
    expect((await listProducts(a, { active: true })).total).toBe(1);
    expect((await listProducts(a, { active: false })).total).toBe(26);
    const row = (await listProducts(a, { q: "calça" })).items[0];
    expect(row).toMatchObject({ categoryName: "Outra", variantCount: 1, minPriceCents: 4990, totalStock: 2 });
  });
  it("parseProductQuery: invalido -> null, vazio = ausente", () => {
    expect(parseProductQuery(new URLSearchParams("page=2&q=x&active=true&categoryId=abc"))).toEqual({ page: 2, q: "x", active: true, categoryId: "abc" });
    expect(parseProductQuery(new URLSearchParams("page=&q=&active="))).toEqual({});
    for (const qs of ["page=0", "page=-1", "page=1e12", "page=abc", "active=talvez", "categoryId=../x", `q=${"x".repeat(101)}`]) {
      expect(parseProductQuery(new URLSearchParams(qs)), qs).toBeNull();
    }
  });
  it("getProduct de outra loja -> 404", async () => {
    const p = await createProduct(b, input(catB));
    expect(await code(getProduct(a, p.id))).toBe("404 PRODUCT_NOT_FOUND");
    expect((await getProduct(b, p.id)).variants).toHaveLength(2);
  });
});
