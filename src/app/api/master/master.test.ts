import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { STORE_HOST_HEADER } from "@/lib/host";

vi.mock("@/auth", async (orig) => ({ ...(await orig<typeof import("@/auth")>()), getSession: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
const auth = await import("@/auth");
const nextHeaders = await import("next/headers");
const { masterPage } = await import("@/lib/master-api");
const getSession = vi.mocked(auth.getSession);

const metrics = await import("./metrics/route");
const stores = await import("./stores/route");
const storeId = await import("./stores/[id]/route");
const suspend = await import("./stores/[id]/suspend/route");
const reactivate = await import("./stores/[id]/reactivate/route");
const storePlan = await import("./stores/[id]/plan/route");
const plans = await import("./plans/route");
const planId = await import("./plans/[id]/route");

let tag: string;
let master: Session;
let lojista: Session;
let customer: Session;
let planA: string;
let planB: string;
let storeA: string;
let planDel: string;
const accountIds: string[] = [];
const createdSlugs: string[] = [];

const session = (id: string, kind: "account" | "customer", extra = {}): Session => ({ user: { id, kind, ...extra }, expires: "2099-01-01" });

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  const acc = async (k: string, isMaster: boolean) => {
    const a = await prisma.account.create({ data: { name: k, email: `${k}-${tag}@t.local`, passwordHash: "x", isMaster } });
    accountIds.push(a.id);
    return a.id;
  };
  master = session(await acc("master", true), "account", { isMaster: true });
  lojista = session(await acc("lojista", false), "account", { isMaster: false });
  customer = session("cust-1", "customer", { storeId: "qualquer" });
  const mkPlan = async (k: string) => (await prisma.plan.create({ data: { name: `T8a-${k}-${tag}`, priceCents: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false } })).id;
  planA = await mkPlan("a");
  planB = await mkPlan("b");
  planDel = await mkPlan("del");
  storeA = (await prisma.store.create({ data: { slug: `t8a-${tag}`, name: "Loja A", planId: planA, status: "ACTIVE", subscription: { create: { status: "ACTIVE" } } } })).id;
  createdSlugs.push(`t8a-${tag}`);
  getSession.mockReset();
  vi.mocked(nextHeaders.headers).mockReset();
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { OR: [{ slug: { in: createdSlugs.splice(0) } }, { planId: { in: [planA, planB, planDel] } }] } });
  await prisma.account.deleteMany({ where: { OR: [{ id: { in: accountIds.splice(0) } }, { email: { endsWith: `-${tag}@t.local` } }] } });
  await prisma.plan.deleteMany({ where: { name: { endsWith: `-${tag}` } } });
});
afterAll(() => prisma.$disconnect());

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
type Case = { route: string; method: string; handler: Handler; body?: () => unknown; id?: () => string; ok: number };

// Uma linha por (rota, metodo); o teste "cobre todas as rotas" falha se alguma rota nova ficar fora da tabela.
const cases: Case[] = [
  { route: "metrics", method: "GET", handler: metrics.GET as Handler, ok: 200 },
  { route: "stores", method: "GET", handler: stores.GET as Handler, ok: 200 },
  { route: "stores", method: "POST", handler: stores.POST as Handler, ok: 201, body: () => ({ ownerName: "D", email: `novo-${tag}@t.local`, password: "senha-forte-1", storeName: "Nova", slug: `t8a-n-${tag}`, planId: planA, startMode: "trial" }) },
  { route: "stores/[id]", method: "GET", handler: storeId.GET as Handler, id: () => storeA, ok: 200 },
  { route: "stores/[id]", method: "PATCH", handler: storeId.PATCH as Handler, id: () => storeA, ok: 200, body: () => ({ name: "Outro Nome" }) },
  { route: "stores/[id]/suspend", method: "POST", handler: suspend.POST as Handler, id: () => storeA, ok: 200 },
  { route: "stores/[id]/reactivate", method: "POST", handler: reactivate.POST as Handler, id: () => storeA, ok: 200 },
  { route: "stores/[id]/plan", method: "POST", handler: storePlan.POST as Handler, id: () => storeA, ok: 200, body: () => ({ planId: planB }) },
  { route: "plans", method: "GET", handler: plans.GET as Handler, ok: 200 },
  { route: "plans", method: "POST", handler: plans.POST as Handler, ok: 201, body: () => ({ name: `T8a-novo-${tag}`, priceCents: 500, productLimit: null, staffLimit: 2, customDomain: false, advancedMetrics: false, csvExport: false }) },
  { route: "plans/[id]", method: "PATCH", handler: planId.PATCH as Handler, id: () => planA, ok: 200, body: () => ({ priceCents: 700, active: false }) },
  { route: "plans/[id]", method: "DELETE", handler: planId.DELETE as Handler, id: () => planDel, ok: 200 },
];

// Origin proprio por padrao (como um navegador na pagina do painel); valor undefined remove o header.
const call = (c: Case, extraHeaders: Record<string, string | undefined> = {}) => {
  const headers = Object.entries({ "content-type": "application/json", origin: "http://localhost", ...extraHeaders }).filter((e): e is [string, string] => e[1] !== undefined);
  return c.handler(
    new Request("http://localhost/api/master/x", { method: c.method, headers, body: c.body ? JSON.stringify(c.body()) : undefined }),
    { params: Promise.resolve({ id: c.id?.() ?? "" }) },
  );
};
const label = (c: Case) => `${c.method} /api/master/${c.route}`;

describe("/api/master: todas as rotas exigem master", () => {
  it("a tabela cobre todos os route.ts (e todos os metodos exportados) de src/app/api/master", () => {
    const root = join(process.cwd(), "src/app/api/master");
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
  it.each(cases)("$method $route: conta que nao e master 403", async (c) => {
    getSession.mockResolvedValue(lojista);
    expect((await call(c)).status).toBe(403);
  });
  it.each(cases)("$method $route: token com isMaster forjado mas conta sem isMaster no banco 403", async (c) => {
    getSession.mockResolvedValue({ ...lojista, user: { ...lojista.user, isMaster: true } });
    expect((await call(c)).status).toBe(403);
  });
  it.each(cases)("$method $route: host de loja 404 (ate para master)", async (c) => {
    getSession.mockResolvedValue(master);
    expect((await call(c, { [STORE_HOST_HEADER]: "loja.localhost" })).status).toBe(404);
  });
  it.each(cases)("$method $route: master passa", async (c) => {
    getSession.mockResolvedValue(master);
    const res = await call(c);
    expect(res.status, label(c) + " " + (await res.clone().text())).toBe(c.ok);
  });

  const mutating = cases.filter((c) => c.method !== "GET");
  it.each(mutating)("$method $route: CSRF, Origin estrangeiro 403", async (c) => {
    getSession.mockResolvedValue(master);
    expect((await call(c, { origin: "https://evil.example" })).status).toBe(403);
  });
  it.each(mutating)("$method $route: CSRF, sem Origin e Sec-Fetch-Site cross-site 403", async (c) => {
    getSession.mockResolvedValue(master);
    expect((await call(c, { origin: undefined, "sec-fetch-site": "cross-site" })).status).toBe(403);
  });
  it.each(mutating)("$method $route: CSRF, sem Origin e sem Sec-Fetch-Site 403", async (c) => {
    getSession.mockResolvedValue(master);
    expect((await call(c, { origin: undefined })).status).toBe(403);
  });
  it.each(mutating)("$method $route: sem Origin mas Sec-Fetch-Site same-origin passa", async (c) => {
    getSession.mockResolvedValue(master);
    expect((await call(c, { origin: undefined, "sec-fetch-site": "same-origin" })).status).toBe(c.ok);
  });
  it.each(mutating.filter((c) => c.body))("$method $route: corpo text/plain 403", async (c) => {
    getSession.mockResolvedValue(master);
    expect((await call(c, { "content-type": "text/plain" })).status).toBe(403);
  });
  it.each(mutating)("$method $route: anonimo com Origin estrangeiro recebe 401 (auth antes de CSRF)", async (c) => {
    getSession.mockResolvedValue(null);
    expect((await call(c, { origin: "https://evil.example" })).status).toBe(401);
  });
  it("CSRF recusado nao executa a acao", async () => {
    getSession.mockResolvedValue(master);
    await call(cases.find((c) => c.route === "stores/[id]/suspend")!, { origin: "https://evil.example" });
    expect((await prisma.store.findUniqueOrThrow({ where: { id: storeA } })).status).toBe("ACTIVE");
  });

  it("recusas nao executam a acao", async () => {
    getSession.mockResolvedValue(lojista);
    await call(cases.find((c) => c.route === "stores/[id]/suspend")!);
    await call(cases.find((c) => c.route === "plans/[id]" && c.method === "DELETE")!);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: storeA } })).status).toBe("ACTIVE");
    expect(await prisma.plan.findUnique({ where: { id: planDel } })).not.toBeNull();
  });
});

describe("/api/master: comportamento", () => {
  beforeEach(() => getSession.mockResolvedValue(master));
  const run = (route: string, method: string, body?: unknown, id = "") => {
    const c = cases.find((x) => x.route === route && x.method === method)!;
    return call({ ...c, body: body === undefined ? undefined : () => body, id: () => id });
  };

  it("suspender/reativar/trocar plano mexem na loja certa", async () => {
    await run("stores/[id]/suspend", "POST", undefined, storeA);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: storeA } })).status).toBe("SUSPENDED");
    await run("stores/[id]/reactivate", "POST", undefined, storeA);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: storeA } })).status).toBe("ACTIVE");
    await run("stores/[id]/plan", "POST", { planId: planB }, storeA);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: storeA } })).planId).toBe(planB);
  });

  it("erros de dominio viram status HTTP", async () => {
    expect((await run("stores/[id]/suspend", "POST", undefined, "nao-existe")).status).toBe(404);
    expect((await run("stores/[id]/plan", "POST", { planId: "nao-existe" }, storeA)).status).toBe(404);
    expect((await run("stores/[id]/plan", "POST", {}, storeA)).status).toBe(400);
    expect((await run("stores", "POST", { ownerName: "D", email: `x-${tag}@t.local`, storeName: "Nova", planId: planA, startMode: "trial" })).status).toBe(400); // sem senha
    createdSlugs.push(`t8a-s-${tag}`);
    expect((await run("stores", "POST", { ownerName: "D", email: `y-${tag}@t.local`, password: "senha-forte-1", storeName: "Nova", slug: "master", planId: planA, startMode: "trial" })).status).toBe(400);
    expect((await run("plans", "POST", { name: `T8a-a-${tag}`, priceCents: 1, productLimit: null, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false })).status).toBe(409);
    expect((await run("plans", "POST", { name: `T8a-z-${tag}`, priceCents: -1, productLimit: null, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false })).status).toBe(400);
    expect((await run("plans/[id]", "DELETE", undefined, planA)).status).toBe(409); // planA tem a storeA
    expect((await run("plans/[id]", "DELETE", undefined, "nao-existe")).status).toBe(404);
  });

  it("GET /stores aplica os filtros e GET /metrics devolve numeros", async () => {
    const list = await (await call({ ...cases.find((c) => c.route === "stores" && c.method === "GET")!, handler: ((r: Request) => stores.GET(r)) as Handler })).json();
    expect(list.total).toBeGreaterThan(0);
    const filtered = await (await stores.GET(new Request(`http://localhost/api/master/stores?status=ACTIVE&planId=${planA}&q=loja%20a`))).json();
    expect(filtered.stores.map((s: { id: string }) => s.id)).toEqual([storeA]);
    const m = await (await metrics.GET(new Request("http://localhost/api/master/metrics"))).json();
    expect(m.signupsByDay).toHaveLength(30);
    expect(m.activeStores).toBeGreaterThanOrEqual(1);
  });
  it.each([
    "status=constructor", "status=__proto__", "status=active", "page=Infinity", "page=1e12", "page=NaN", "page=-1", "page=0", "page=1.5", "page=abc", "planId=" + encodeURIComponent("a b;'--"),
  ])("GET /stores?%s -> 400 (nunca 500)", async (qs) => {
    const res = await stores.GET(new Request(`http://localhost/api/master/stores?${qs}`));
    expect(res.status).toBe(400);
  });
  it("GET /stores com page valida alem do fim devolve lista vazia; filtros vazios sao ignorados", async () => {
    expect((await (await stores.GET(new Request("http://localhost/api/master/stores?page=99999"))).json()).stores).toEqual([]);
    expect((await stores.GET(new Request("http://localhost/api/master/stores?status=&planId=&q=&page="))).status).toBe(200);
  });
  it("EmailExistsError de corrida vira 409", async () => {
    const { EmailExistsError } = await import("@/domain/stores");
    const { domainError } = await import("@/lib/master-api");
    expect(domainError(new EmailExistsError("x")).status).toBe(409);
  });
});

describe("paginas /master", () => {
  it("masterPage: host de loja -> notFound; anonimo/nao master -> redirect; master passa", async () => {
    const hdr = (h: Record<string, string>) => vi.mocked(nextHeaders.headers).mockResolvedValue(new Headers(h) as never);
    hdr({ [STORE_HOST_HEADER]: "loja.localhost" });
    getSession.mockResolvedValue(master);
    await expect(masterPage()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404") });
    hdr({});
    getSession.mockResolvedValue(null);
    await expect(masterPage()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    getSession.mockResolvedValue(lojista);
    await expect(masterPage()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    getSession.mockResolvedValue(customer);
    await expect(masterPage()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    getSession.mockResolvedValue(master);
    await expect(masterPage()).resolves.toBeDefined();
  });

  it("toda page.tsx de src/app/master abre com await masterPage()", () => {
    const root = join(process.cwd(), "src/app/master");
    const pages: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f === "page.tsx") pages.push(p);
    });
    walk(root);
    expect(pages.length).toBeGreaterThanOrEqual(5);
    for (const p of pages) {
      const src = readFileSync(p, "utf8");
      expect(src, p).toMatch(/export default async function \w+\([^)]*\)\s*\{\s*await masterPage\(\)/);
    }
  });

  it("nenhum arquivo de src/app/master ou src/app/api/master usa 'use server' (server action pularia o guard da pagina)", () => {
    const hits: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => {
      const p = join(d, f);
      if (statSync(p).isDirectory()) return walk(p);
      if (/use server/.test(readFileSync(p, "utf8")) && f !== "master.test.ts") hits.push(p);
    });
    walk(join(process.cwd(), "src/app/master"));
    walk(join(process.cwd(), "src/app/api/master"));
    expect(hits).toEqual([]);
  });
});
