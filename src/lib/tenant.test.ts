import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { seed } from "../../prisma/seed";
import { resolveStoreByHost } from "./tenant";
import { normalizeHost } from "./host";

const PD = "plataforma.test";
let demoId: string;
const stores: string[] = [];

beforeAll(async () => {
  process.env.SEED_MASTER_EMAIL = "master@test.local";
  process.env.SEED_MASTER_PASSWORD = "senha-teste-123";
  await seed(prisma);
  demoId = (await prisma.store.findUniqueOrThrow({ where: { slug: "demo" } })).id;
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } }); // cascata leva os dominios
});
afterAll(() => prisma.$disconnect());

async function storeWithDomain(host: string, verified: boolean) {
  const planId = (await prisma.plan.findFirstOrThrow()).id;
  const tag = Math.random().toString(36).slice(2, 8);
  const s = await prisma.store.create({ data: { slug: `dom-${tag}`, name: "D", planId, domains: { create: { host, verified } } } });
  stores.push(s.id);
  return s.id;
}

describe("resolveStoreByHost", () => {
  it("subdominio da plataforma resolve a loja (com porta e maiusculas)", async () => {
    expect((await resolveStoreByHost("demo.plataforma.test", PD))?.id).toBe(demoId);
    expect((await resolveStoreByHost("demo.plataforma.test:3000", PD))?.id).toBe(demoId);
    expect((await resolveStoreByHost("DEMO.Plataforma.TEST", PD))?.id).toBe(demoId);
  });
  it("host desconhecido -> null", async () => {
    expect(await resolveStoreByHost("nao-existe.plataforma.test", PD)).toBeNull();
    expect(await resolveStoreByHost("loja.qualquer.com", PD)).toBeNull();
    expect(await resolveStoreByHost("a.demo.plataforma.test", PD)).toBeNull();
    expect(await resolveStoreByHost("", PD)).toBeNull();
  });
  it("host da plataforma nao e loja", async () => {
    for (const h of ["plataforma.test", "www.plataforma.test", "PLATAFORMA.test:3000"]) {
      expect(await resolveStoreByHost(h, PD), h).toBeNull();
    }
  });
  it("dominio proprio: nao verificado -> null, verificado -> loja", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    await storeWithDomain(`nv-${tag}.com.br`, false);
    expect(await resolveStoreByHost(`nv-${tag}.com.br`, PD)).toBeNull();
    const id = await storeWithDomain(`ok-${tag}.com.br`, true);
    expect((await resolveStoreByHost(`OK-${tag}.com.br:443`, PD))?.id).toBe(id);
  });
});

describe("normalizeHost", () => {
  it("minusculas, sem porta, sem ponto final", () => {
    expect(normalizeHost(" Demo.Plataforma.Test:3000 ")).toBe("demo.plataforma.test");
    expect(normalizeHost("loja.com.")).toBe("loja.com");
    expect(normalizeHost(null)).toBe("");
  });
});
