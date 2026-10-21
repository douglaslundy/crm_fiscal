import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "./route";

let planId: string;
const stores: string[] = [];
const ask = async (domain: string) => (await GET(new Request(`http://app/api/tls-check?domain=${encodeURIComponent(domain)}`))).status;

beforeEach(async () => {
  process.env.PLATFORM_DOMAIN = "plat.test";
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-Tls" }, update: {},
    create: { name: "Teste-Tls", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Tls" } });
  await prisma.$disconnect();
});

describe("GET /api/tls-check", () => {
  it("200 para a plataforma, www e subdominio de loja existente; 404 para o resto", async () => {
    const slug = `tls-${Math.random().toString(36).slice(2, 8)}`;
    stores.push((await prisma.store.create({ data: { slug, name: "L", planId } })).id);
    expect(await ask("plat.test")).toBe(200);
    expect(await ask("www.plat.test")).toBe(200);
    expect(await ask(`${slug}.plat.test`)).toBe(200);
    expect(await ask("nao-existe.plat.test")).toBe(404);
    expect(await ask("evil.com")).toBe(404);
    expect(await ask("")).toBe(404);
  });
});
