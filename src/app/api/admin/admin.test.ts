import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { dbForStore } from "@/lib/db-store";
import { STORE_HOST_HEADER } from "@/lib/host";
import { MemoryStorage, PNG } from "../../../../tests/fake-storage";

vi.mock("@/auth", async (orig) => ({ ...(await orig<typeof import("@/auth")>()), getSession: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
const storage = new MemoryStorage();
vi.mock("@/integrations/storage", async (orig) => ({ ...(await orig<typeof import("@/integrations/storage")>()), getStorage: () => storage }));
const auth = await import("@/auth");
const nextHeaders = await import("next/headers");
const { adminPage } = await import("@/lib/admin-api");
const getSession = vi.mocked(auth.getSession);

const categories = await import("./categories/route");
const categoryId = await import("./categories/[id]/route");
const upload = await import("./upload/route");
const products = await import("./products/route");
const productId = await import("./products/[id]/route");
const variants = await import("./products/[id]/variants/route");
const variantId = await import("./products/[id]/variants/[variantId]/route");

let tag: string;
let planId: string;
let storeA: string;
let storeB: string;
let hostA: string;
let catA: string;
let catB: string;
let prodA: string;
let varA1: string;
let varA2: string;
let prodB: string;
let varB: string;
let ownerA: Session;
let staffA: Session;
let ownerB: Session;
let master: Session;
let customer: Session;
const storeIds: string[] = [];
const accountIds: string[] = [];

const session = (id: string, kind: "account" | "customer", extra = {}): Session => ({ user: { id, kind, ...extra }, expires: "2099-01-01" });

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.create({ data: { name: `T9a-${tag}`, priceCents: 1, staffLimit: 3, customDomain: false, advancedMetrics: false, csvExport: false } })).id;
  const acc = async (k: string, isMaster = false) => {
    const a = await prisma.account.create({ data: { name: k, email: `${k}-${tag}@t.local`, passwordHash: "x", isMaster } });
    accountIds.push(a.id);
    return a.id;
  };
  const [oa, sa, ob, ms] = [await acc("oa"), await acc("sa"), await acc("ob"), await acc("ms", true)];
  const mk = async (k: string, members: { accountId: string; role: "OWNER" | "STAFF" }[]) => {
    const s = await prisma.store.create({ data: { slug: `t9a-${k}-${tag}`, name: k, planId, status: "ACTIVE", members: { create: members } } });
    storeIds.push(s.id);
    return s.id;
  };
  storeA = await mk("a", [{ accountId: oa, role: "OWNER" }, { accountId: sa, role: "STAFF" }]);
  storeB = await mk("b", [{ accountId: ob, role: "OWNER" }]);
  hostA = `t9a-a-${tag}.localhost`;
  catA = (await dbForStore(storeA).category.create({ data: { storeId: storeA, name: "Cat A", slug: "cat-a" } })).id;
  catB = (await dbForStore(storeB).category.create({ data: { storeId: storeB, name: "Cat B", slug: "cat-b" } })).id;
  // Sem categoria de proposito: as linhas de categories (DELETE catA, contagens) seguem como antes.
  const mkProduct = async (storeId: string, categoryId: null, skus: string[]) => {
    const db = dbForStore(storeId);
    const p = await db.product.create({ data: { storeId, categoryId, slug: "camiseta", name: "Camiseta", weightGrams: 300, heightCm: 4, widthCm: 25, lengthCm: 30 } });
    const vs = [];
    for (const [i, sku] of skus.entries()) vs.push((await db.variant.create({ data: { storeId, productId: p.id, sku, color: "Preto", size: `T${i}`, priceCents: 4990, stock: 3 } })).id);
    return [p.id, ...vs];
  };
  [prodA, varA1, varA2] = await mkProduct(storeA, null, ["sku-a1", "sku-a2"]);
  [prodB, varB] = await mkProduct(storeB, null, ["sku-b1"]);
  ownerA = session(oa, "account");
  staffA = session(sa, "account");
  ownerB = session(ob, "account");
  master = session(ms, "account", { isMaster: true });
  customer = session("cust-1", "customer", { storeId: storeA });
  getSession.mockReset();
  vi.mocked(nextHeaders.headers).mockReset();
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: storeIds.splice(0) } } });
  await prisma.account.deleteMany({ where: { id: { in: accountIds.splice(0) } } });
  await prisma.plan.deleteMany({ where: { id: planId } });
});
afterAll(() => prisma.$disconnect());

type Handler = (req: Request, ctx: { params: Promise<{ id: string; variantId: string }> }) => Promise<Response>;
type Case = { route: string; method: string; handler: Handler; body?: () => unknown; multipart?: () => FormData; id?: () => string; variantId?: () => string; ok: number };
const newProduct = () => ({
  name: "Nova Camiseta", categoryId: catA, weightGrams: 200, heightCm: 2, widthCm: 20, lengthCm: 30,
  variants: [{ color: "Azul", size: "M", sku: "nova-azul-m", priceCents: 5990, stock: 1 }],
});
const pngForm = () => {
  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), "x.png");
  return fd;
};

// Uma linha por (rota, metodo); o teste "cobre todas as rotas" falha se alguma rota nova ficar fora da tabela.
const cases: Case[] = [
  { route: "categories", method: "GET", handler: categories.GET as Handler, ok: 200 },
  { route: "categories", method: "POST", handler: categories.POST as Handler, ok: 201, body: () => ({ name: "Nova" }) },
  { route: "categories/[id]", method: "PATCH", handler: categoryId.PATCH as Handler, id: () => catA, ok: 200, body: () => ({ name: "Renomeada" }) },
  { route: "categories/[id]", method: "DELETE", handler: categoryId.DELETE as Handler, id: () => catA, ok: 200 },
  { route: "upload", method: "POST", handler: upload.POST as Handler, ok: 201, multipart: pngForm },
  { route: "products", method: "GET", handler: products.GET as Handler, ok: 200 },
  { route: "products", method: "POST", handler: products.POST as Handler, ok: 201, body: newProduct },
  { route: "products/[id]", method: "GET", handler: productId.GET as Handler, id: () => prodA, ok: 200 },
  { route: "products/[id]", method: "PATCH", handler: productId.PATCH as Handler, id: () => prodA, ok: 200, body: () => ({ weightGrams: 999 }) },
  { route: "products/[id]", method: "DELETE", handler: productId.DELETE as Handler, id: () => prodA, ok: 200 },
  { route: "products/[id]/variants", method: "POST", handler: variants.POST as Handler, id: () => prodA, ok: 201, body: () => ({ color: "Verde", size: "G", sku: "verde-g", priceCents: 100, stock: 1 }) },
  { route: "products/[id]/variants/[variantId]", method: "PATCH", handler: variantId.PATCH as Handler, id: () => prodA, variantId: () => varA1, ok: 200, body: () => ({ stock: 7 }) },
  { route: "products/[id]/variants/[variantId]", method: "DELETE", handler: variantId.DELETE as Handler, id: () => prodA, variantId: () => varA1, ok: 200 },
];

// Host da loja A e Origin proprio por padrao (como o navegador no painel); valor undefined remove o header.
// Corpo multipart: sem content-type explicito o Request gera multipart/form-data com boundary.
const call = (c: Case, extraHeaders: Record<string, string | undefined> = {}) => {
  const headers = Object.entries({ "content-type": c.multipart ? undefined : "application/json", origin: "http://localhost", [STORE_HOST_HEADER]: hostA, ...extraHeaders }).filter((e): e is [string, string] => e[1] !== undefined);
  return c.handler(
    new Request("http://localhost/api/admin/x", { method: c.method, headers, body: c.multipart ? c.multipart() : c.body ? JSON.stringify(c.body()) : undefined }),
    { params: Promise.resolve({ id: c.id?.() ?? "", variantId: c.variantId?.() ?? "" }) },
  );
};

describe("/api/admin: todas as rotas exigem membro da loja", () => {
  it("a tabela cobre todos os route.ts (e todos os metodos exportados) de src/app/api/admin", () => {
    const root = join(process.cwd(), "src/app/api/admin");
    const found: string[] = [];
    const VERB = "GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS";
    const walk = (d: string) => readdirSync(d).forEach((f) => {
      const p = join(d, f);
      if (statSync(p).isDirectory()) return walk(p);
      if (!/^route\.[cm]?[jt]sx?$/.test(f)) return;
      expect(f, `${p}: use route.ts`).toBe("route.ts");
      const src = readFileSync(p, "utf8");
      const methods = new Set([
        ...[...src.matchAll(new RegExp(String.raw`export\s+(?:async\s+)?function\s+(${VERB})\b`, "g"))].map((m) => m[1]),
        ...[...src.matchAll(new RegExp(String.raw`export\s+(?:const|let|var)\s+(${VERB})\b`, "g"))].map((m) => m[1]),
        ...[...src.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(new RegExp(String.raw`(?:\bas\s+)?\b(${VERB})\b`, "g"))].map((x) => x[1])),
      ]);
      expect(src, `${p}: re-export de verbo nao suportado pelo scan`).not.toMatch(/export\s*\*\s*from/);
      const dir = relative(root, d).split(sep).join("/");
      methods.forEach((m) => found.push(`${m} ${dir}`));
    });
    walk(root);
    expect(found.sort()).toEqual(cases.map((c) => `${c.method} ${c.route}`).sort());
  });

  it.each(cases)("$method $route: anonimo 401", async (c) => {
    getSession.mockResolvedValue(null);
    expect((await call(c)).status).toBe(401);
  });
  it.each(cases)("$method $route: token de cliente 403", async (c) => {
    getSession.mockResolvedValue(customer);
    expect((await call(c)).status).toBe(403);
  });
  it.each(cases)("$method $route: conta de outra loja (nao membro) 403", async (c) => {
    getSession.mockResolvedValue(ownerB);
    expect((await call(c)).status).toBe(403);
  });
  it.each(cases)("$method $route: token com isMaster forjado mas conta sem isMaster no banco 403", async (c) => {
    getSession.mockResolvedValue({ ...ownerB, user: { ...ownerB.user, isMaster: true } });
    expect((await call(c)).status).toBe(403);
  });
  it.each(cases)("$method $route: host da plataforma (sem host de loja) 404", async (c) => {
    getSession.mockResolvedValue(ownerA);
    expect((await call(c, { [STORE_HOST_HEADER]: undefined })).status).toBe(404);
  });
  it.each(cases)("$method $route: loja desconhecida 404", async (c) => {
    getSession.mockResolvedValue(ownerA);
    expect((await call(c, { [STORE_HOST_HEADER]: "nao-existe-xyz.localhost" })).status).toBe(404);
  });
  it.each(cases)("$method $route: dono passa", async (c) => {
    getSession.mockResolvedValue(ownerA);
    const res = await call(c);
    expect(res.status, await res.clone().text()).toBe(c.ok);
  });
  it.each(cases)("$method $route: colaborador (STAFF) passa", async (c) => {
    getSession.mockResolvedValue(staffA);
    const res = await call(c);
    expect(res.status, await res.clone().text()).toBe(c.ok);
  });
  it.each(cases)("$method $route: master passa (suporte)", async (c) => {
    getSession.mockResolvedValue(master);
    const res = await call(c);
    expect(res.status, await res.clone().text()).toBe(c.ok);
  });

  beforeEach(() => storage.files.clear());
  it.each(cases)("$method $route: loja suspensa, leitura passa e escrita 403 STORE_SUSPENDED", async (c) => {
    for (const status of ["SUSPENDED", "CANCELED"] as const) {
      await prisma.store.update({ where: { id: storeA }, data: { status } });
      getSession.mockResolvedValue(ownerA);
      const res = await call(c);
      if (c.method === "GET") expect(res.status).toBe(200);
      else {
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: "STORE_SUSPENDED" });
      }
    }
    expect(await prisma.category.count({ where: { id: catA } })).toBe(1);
    expect(await prisma.category.count({ where: { storeId: storeA } })).toBe(1);
    expect(await prisma.product.findMany({ where: { storeId: storeA }, select: { id: true, weightGrams: true } })).toEqual([{ id: prodA, weightGrams: 300 }]);
    expect(await prisma.variant.count({ where: { productId: prodA, stock: 3 } })).toBe(2);
    expect(storage.files.size).toBe(0);
  });

  const mutating = cases.filter((c) => c.method !== "GET");
  it.each(mutating)("$method $route: CSRF, Origin estrangeiro 403", async (c) => {
    getSession.mockResolvedValue(ownerA);
    expect((await call(c, { origin: "https://evil.example" })).status).toBe(403);
  });
  it.each(mutating)("$method $route: CSRF, sem Origin e Sec-Fetch-Site cross-site 403", async (c) => {
    getSession.mockResolvedValue(ownerA);
    expect((await call(c, { origin: undefined, "sec-fetch-site": "cross-site" })).status).toBe(403);
  });
  it.each(mutating)("$method $route: CSRF, sem Origin e sem Sec-Fetch-Site 403", async (c) => {
    getSession.mockResolvedValue(ownerA);
    expect((await call(c, { origin: undefined })).status).toBe(403);
  });
  it.each(mutating)("$method $route: sem Origin mas Sec-Fetch-Site same-origin passa", async (c) => {
    getSession.mockResolvedValue(ownerA);
    expect((await call(c, { origin: undefined, "sec-fetch-site": "same-origin" })).status).toBe(c.ok);
  });
  it.each(mutating.filter((c) => c.body || c.multipart))("$method $route: corpo text/plain 403", async (c) => {
    getSession.mockResolvedValue(ownerA);
    expect((await call(c, { "content-type": "text/plain" })).status).toBe(403);
  });
  it.each(mutating.filter((c) => c.body))("$method $route: corpo multipart 403 (so a rota de upload aceita)", async (c) => {
    getSession.mockResolvedValue(ownerA);
    expect((await call({ ...c, body: undefined, multipart: pngForm })).status).toBe(403);
  });
  it.each(mutating.filter((c) => c.multipart))("$method $route: corpo JSON 403 (rota multipart)", async (c) => {
    getSession.mockResolvedValue(ownerA);
    expect((await call({ ...c, multipart: undefined, body: () => ({ file: "x" }) })).status).toBe(403);
  });
  it.each(mutating)("$method $route: anonimo com Origin estrangeiro recebe 401 (auth antes de CSRF)", async (c) => {
    getSession.mockResolvedValue(null);
    expect((await call(c, { origin: "https://evil.example" })).status).toBe(401);
  });
  it("membro removido e recusado na chamada seguinte (permissao relida do banco)", async () => {
    getSession.mockResolvedValue(staffA);
    expect((await call(cases[0])).status).toBe(200);
    await prisma.storeMember.deleteMany({ where: { storeId: storeA, accountId: staffA.user.id } });
    expect((await call(cases[0])).status).toBe(403);
    expect((await call(cases[1])).status).toBe(403);
  });
  it("recusas nao executam a acao", async () => {
    getSession.mockResolvedValue(ownerB);
    await call(cases.find((c) => c.method === "DELETE")!);
    await call(cases.find((c) => c.method === "PATCH")!);
    getSession.mockResolvedValue(ownerA);
    await call(cases.find((c) => c.method === "DELETE")!, { origin: "https://evil.example" });
    expect(await prisma.category.findUniqueOrThrow({ where: { id: catA } })).toMatchObject({ name: "Cat A" });
  });
});

describe("/api/admin/categories: comportamento", () => {
  beforeEach(() => getSession.mockResolvedValue(staffA));
  const send = (route: string, method: string, body?: unknown, id = "") =>
    call({ ...cases.find((x) => x.route === route && x.method === method)!, body: body === undefined ? undefined : () => body, id: () => id });

  it("cria com slug automatico e lista so a loja do host", async () => {
    const res = await send("categories", "POST", { name: "Calças Jeans" });
    expect(await res.json()).toMatchObject({ slug: "calcas-jeans", storeId: storeA });
    const list = await (await send("categories", "GET")).json();
    expect(list.map((c: { name: string }) => c.name).sort()).toEqual(["Calças Jeans", "Cat A"]);
    expect(list.find((c: { name: string }) => c.name === "Cat A")).toMatchObject({ productCount: 0, childCount: 0 });
  });
  it("erros de dominio viram status HTTP, nunca 500", async () => {
    const code = async (r: Promise<Response>) => { const x = await r; return [x.status, (await x.json()).error]; };
    expect(await code(send("categories", "POST", { name: "Cat A" }))).toEqual([409, "SLUG_TAKEN"]);
    expect(await code(send("categories", "POST", { name: "X", slug: "Ruim Slug" }))).toEqual([400, "SLUG_INVALID"]);
    expect(await code(send("categories", "POST", { name: "!!!" }))).toEqual([400, "SLUG_INVALID"]);
    expect((await send("categories", "POST", { name: "" })).status).toBe(400);
    expect((await send("categories", "POST", { name: "n".repeat(61) })).status).toBe(400);
    expect((await send("categories", "POST", { name: 5 })).status).toBe(400);
    expect((await send("categories", "POST", { name: "Y", parentId: 7 })).status).toBe(400);
    expect(await code(send("categories", "POST", { name: "Y", parentId: catB }))).toEqual([400, "PARENT_NOT_FOUND"]);
    expect(await code(send("categories", "POST", { name: "Y", parentId: "nao-existe" }))).toEqual([400, "PARENT_NOT_FOUND"]);
    expect(await code(send("categories/[id]", "PATCH", { parentId: catA }, catA))).toEqual([400, "PARENT_CYCLE"]);
    expect(await code(send("categories/[id]", "PATCH", { parentId: catB }, catA))).toEqual([400, "PARENT_NOT_FOUND"]);
    expect(await code(send("categories/[id]", "PATCH", { name: "Hack" }, catB))).toEqual([404, "CATEGORY_NOT_FOUND"]);
    expect(await code(send("categories/[id]", "DELETE", undefined, catB))).toEqual([404, "CATEGORY_NOT_FOUND"]);
    expect(await code(send("categories/[id]", "DELETE", undefined, "nao-existe"))).toEqual([404, "CATEGORY_NOT_FOUND"]);
    expect(await prisma.category.findUniqueOrThrow({ where: { id: catB } })).toMatchObject({ name: "Cat B" });
  });
  it("campos vazios do formulario: slug vazio = automatico, parentId vazio = raiz", async () => {
    const c = await (await send("categories", "POST", { name: "Sem Slug", slug: "", parentId: "" })).json();
    expect(c).toMatchObject({ slug: "sem-slug", parentId: null });
    const child = await (await send("categories", "POST", { name: "Filha", parentId: c.id })).json();
    const moved = await send("categories/[id]", "PATCH", { name: "Filha 2", slug: "", parentId: "" }, child.id);
    expect(await moved.json()).toMatchObject({ name: "Filha 2", slug: "filha", parentId: null });
  });
  it("profundidade, ciclo e exclusao em uso", async () => {
    const mk = async (name: string, parentId?: string) => (await (await send("categories", "POST", { name, parentId })).json()).id as string;
    const l2 = await mk("L2", catA);
    const l3 = await mk("L3", l2);
    const r = await send("categories", "POST", { name: "L4", parentId: l3 });
    expect([r.status, (await r.json()).error]).toEqual([400, "MAX_DEPTH"]);
    const cyc = await send("categories/[id]", "PATCH", { parentId: l3 }, catA);
    expect([cyc.status, (await cyc.json()).error]).toEqual([400, "PARENT_CYCLE"]);
    const del = await send("categories/[id]", "DELETE", undefined, catA);
    expect([del.status, (await del.json()).error]).toEqual([409, "CATEGORY_IN_USE"]);
    expect((await send("categories/[id]", "DELETE", undefined, l3)).status).toBe(200);
  });
});

describe("/api/admin/products: comportamento", () => {
  beforeEach(() => getSession.mockResolvedValue(staffA));
  const send = (route: string, method: string, body?: unknown, id = "", vid = "", qs = "") => {
    const c = cases.find((x) => x.route === route && x.method === method)!;
    const headers = { "content-type": "application/json", origin: "http://localhost", [STORE_HOST_HEADER]: hostA };
    return c.handler(
      new Request(`http://localhost/api/admin/x${qs}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      { params: Promise.resolve({ id, variantId: vid }) },
    );
  };
  const res = async (r: Promise<Response>) => { const x = await r; return [x.status, (await x.json()).error]; };

  it("JSON invalido ou campos fora da faixa -> 400, nunca 500", async () => {
    for (const body of [null, "x", [], { ...newProduct(), name: "" }, { ...newProduct(), weightGrams: "1" }, { ...newProduct(), heightCm: 106 },
      { ...newProduct(), variants: [{ color: "A", size: "P", sku: "s", priceCents: -5, stock: 1 }] }, { ...newProduct(), images: Array(11).fill({ url: "x" }) },
      { ...newProduct(), categoryId: undefined }]) {
      expect((await send("products", "POST", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await send("products/[id]", "PATCH", { active: "sim" }, prodA)).status).toBe(400);
    expect((await send("products/[id]/variants", "POST", { color: "A" }, prodA)).status).toBe(400);
    expect((await send("products/[id]/variants/[variantId]", "PATCH", { stock: 1.5 }, prodA, varA1)).status).toBe(400);
  });
  it("erros de regra viram status HTTP", async () => {
    expect(await res(send("products", "POST", { ...newProduct(), categoryId: catB }))).toEqual([400, "CATEGORY_INVALID"]);
    expect(await res(send("products", "POST", { ...newProduct(), variants: [{ color: "A", size: "P", sku: "sku-a1", priceCents: 1, stock: 1 }] }))).toEqual([409, "SKU_TAKEN"]);
    expect(await res(send("products", "POST", { ...newProduct(), name: "Camiseta" }))).toEqual([409, "SLUG_TAKEN"]);
    expect(await res(send("products", "POST", { ...newProduct(), variants: [] }))).toEqual([400, "NO_ACTIVE_VARIANT"]);
    expect(await res(send("products", "POST", { ...newProduct(), images: [{ url: "https://evil.example/a.png" }] }))).toEqual([400, "IMAGE_URL_INVALID"]);
    expect(await res(send("products/[id]", "GET", undefined, prodB))).toEqual([404, "PRODUCT_NOT_FOUND"]);
    expect(await res(send("products/[id]", "PATCH", { name: "Hack" }, prodB))).toEqual([404, "PRODUCT_NOT_FOUND"]);
    expect(await res(send("products/[id]", "DELETE", undefined, prodB))).toEqual([404, "PRODUCT_NOT_FOUND"]);
    expect(await res(send("products/[id]/variants", "POST", { color: "X", size: "P", sku: "zz", priceCents: 1, stock: 0 }, prodB))).toEqual([404, "PRODUCT_NOT_FOUND"]);
    expect(await res(send("products/[id]/variants/[variantId]", "PATCH", { stock: 0 }, prodA, varB))).toEqual([404, "VARIANT_NOT_FOUND"]);
    expect(await res(send("products/[id]/variants/[variantId]", "DELETE", undefined, prodB, varB))).toEqual([404, "VARIANT_NOT_FOUND"]);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: prodB } })).toMatchObject({ name: "Camiseta" });
    expect(await prisma.variant.count({ where: { id: varB } })).toBe(1);
  });
  it("limite do plano -> 403 PLAN_LIMIT com mensagem", async () => {
    await prisma.plan.update({ where: { id: planId }, data: { productLimit: 1 } });
    const r = await send("products", "POST", newProduct());
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "PLAN_LIMIT", code: "PRODUCT_LIMIT", limit: 1 });
  });
  it("historico de pedidos: 409 e desativar continua possivel", async () => {
    const db = dbForStore(storeA);
    const c = await db.customer.create({ data: { storeId: storeA, name: "C", email: `c-${tag}@t.local`, cpf: "1", phone: "1", passwordHash: "x" } });
    const o = await db.order.create({ data: { storeId: storeA, customerId: c.id, subtotalCents: 1, shippingCents: 0, totalCents: 1, shippingService: "PAC", addressSnapshot: {} } });
    await db.orderItem.create({ data: { storeId: storeA, orderId: o.id, variantId: varA1, productName: "x", sku: "x", color: "x", size: "x", unitPriceCents: 1, quantity: 1 } });
    expect(await res(send("products/[id]", "DELETE", undefined, prodA))).toEqual([409, "PRODUCT_HAS_ORDERS"]);
    expect(await res(send("products/[id]/variants/[variantId]", "DELETE", undefined, prodA, varA1))).toEqual([409, "VARIANT_HAS_ORDERS"]);
    expect((await send("products/[id]/variants/[variantId]", "PATCH", { active: false }, prodA, varA1)).status).toBe(200);
    expect(await res(send("products/[id]/variants/[variantId]", "PATCH", { active: false }, prodA, varA2))).toEqual([400, "LAST_ACTIVE_VARIANT"]);
  });
  it("lista: filtros invalidos -> 400; validos filtram so a loja do host", async () => {
    for (const qs of ["?page=0", "?page=x", "?active=talvez", "?categoryId=../a", `?q=${"x".repeat(101)}`]) {
      expect((await send("products", "GET", undefined, "", "", qs)).status, qs).toBe(400);
    }
    const list = await (await send("products", "GET", undefined, "", "", "?q=sku-a2&active=true")).json();
    expect(list).toMatchObject({ total: 1, page: 1, pageSize: 25, items: [{ id: prodA, variantCount: 2 }] });
    expect((await (await send("products", "GET", undefined, "", "", "?q=sku-b1")).json()).total).toBe(0);
  });
});

describe("paginas /admin", () => {
  const hdr = (h: Record<string, string>) => vi.mocked(nextHeaders.headers).mockResolvedValue(new Headers(h) as never);
  const REDIRECT = { digest: expect.stringContaining("NEXT_REDIRECT") };
  const NOT_FOUND = { digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404") };

  it("adminPage: plataforma e loja desconhecida -> 404; anonimo, cliente e nao membro -> redirect", async () => {
    getSession.mockResolvedValue(ownerA);
    hdr({});
    await expect(adminPage()).rejects.toMatchObject(NOT_FOUND);
    hdr({ [STORE_HOST_HEADER]: "nao-existe-xyz.localhost" });
    await expect(adminPage()).rejects.toMatchObject(NOT_FOUND);
    hdr({ [STORE_HOST_HEADER]: hostA });
    for (const s of [null, customer, ownerB]) {
      getSession.mockResolvedValue(s);
      await expect(adminPage()).rejects.toMatchObject(REDIRECT);
    }
  });
  it("adminPage: STAFF e master passam; role OWNER barra STAFF; suspensa vira readOnly", async () => {
    hdr({ [STORE_HOST_HEADER]: hostA });
    getSession.mockResolvedValue(staffA);
    expect(await adminPage()).toMatchObject({ store: { id: storeA }, readOnly: false });
    await expect(adminPage({ role: "OWNER" })).rejects.toMatchObject(REDIRECT);
    getSession.mockResolvedValue(ownerA);
    await expect(adminPage({ role: "OWNER" })).resolves.toBeDefined();
    getSession.mockResolvedValue(master);
    await expect(adminPage()).resolves.toBeDefined();
    await prisma.store.update({ where: { id: storeA }, data: { status: "SUSPENDED" } });
    getSession.mockResolvedValue(staffA);
    expect(await adminPage()).toMatchObject({ readOnly: true });
  });

  const walkFiles = (root: string, pick: (f: string) => boolean) => {
    const out: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (pick(f)) out.push(p);
    });
    walk(root);
    return out;
  };

  it("toda page.tsx de src/app/admin abre com a guarda (await adminPage(); assinatura usa owner() proprio)", () => {
    const pages = walkFiles(join(process.cwd(), "src/app/admin"), (f) => f === "page.tsx");
    const odd = walkFiles(join(process.cwd(), "src/app/admin"), (f) => /^page\./.test(f) && f !== "page.tsx");
    expect(odd, "use page.tsx (outras extensoes escapariam do scan)").toEqual([]);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const p of pages) {
      const src = readFileSync(p, "utf8");
      const guard = p.split(sep).join("/").endsWith("admin/assinatura/page.tsx") ? "owner\\(\\)" : "adminPage\\(";
      expect(src, p).toMatch(new RegExp(String.raw`export default async function \w+\([^)]*\)\s*\{\s*(?:const\s*\{[^}]*\}\s*=\s*)?await ${guard}`));
    }
  });

  it("'use server' so nas acoes conhecidas da assinatura (server action pularia o guard da pagina)", () => {
    const ALLOWED = ["src/app/admin/assinatura/page.tsx"];
    const hits = [
      ...walkFiles(join(process.cwd(), "src/app/admin"), () => true),
      ...walkFiles(join(process.cwd(), "src/app/api/admin"), () => true),
    ].filter((p) => /use server/.test(readFileSync(p, "utf8")) && !p.endsWith("admin.test.ts"))
      .map((p) => relative(process.cwd(), p).split(sep).join("/"));
    expect(hits.sort()).toEqual(ALLOWED);
  });
});
