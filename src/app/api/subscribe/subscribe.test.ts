import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "./route";

let tag: string;
let planId: string;
let storeId: string;
let host: string;

const send = (body: unknown, o: { ip?: string; host?: string | null; origin?: string } = {}) =>
  POST(new Request("http://localhost/api/subscribe", {
    method: "POST",
    headers: {
      "content-type": "application/json", origin: o.origin ?? "http://localhost", "x-forwarded-for": o.ip ?? `10.4.0.${Math.random().toString(36).slice(2, 8)}`,
      ...(o.host === null ? {} : { "x-store-host": o.host ?? host }),
    },
    body: JSON.stringify(body),
  }));
const ok = { email: "cli@t.local", consent: true };

beforeAll(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  process.env.PLATFORM_DOMAIN = "plataforma.test";
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-SubApi" }, update: {},
    create: { name: "Teste-SubApi", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  storeId = (await prisma.store.create({ data: { slug: `sub-${tag}`, name: "L", planId, status: "ACTIVE" } })).id;
  host = `sub-${tag}.plataforma.test`;
});
afterAll(async () => {
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.plan.deleteMany({ where: { name: "Teste-SubApi" } });
  await prisma.$disconnect();
});

describe("POST /api/subscribe", () => {
  it("201 para novo e repetido, uma linha so; sem consentimento 400; e-mail invalido 400", async () => {
    expect((await send(ok)).status).toBe(201);
    expect((await send(ok)).status).toBe(201);
    expect(await prisma.subscriber.count({ where: { storeId } })).toBe(1);
    expect((await send({ ...ok, consent: false })).status).toBe(400);
    expect((await send({ email: "x", consent: true })).status).toBe(400);
  });
  it("host desconhecido ou ausente 404; origem cruzada 403; loja suspensa 403", async () => {
    expect((await send(ok, { host: "naoexiste.plataforma.test" })).status).toBe(404);
    expect((await send(ok, { host: null })).status).toBe(404);
    expect((await send(ok, { origin: "http://evil.example" })).status).toBe(403);
    await prisma.store.update({ where: { id: storeId }, data: { status: "SUSPENDED" } });
    expect((await send(ok)).status).toBe(403);
    await prisma.store.update({ where: { id: storeId }, data: { status: "ACTIVE" } });
  });
  it("429 apos 10 por hora do mesmo IP na mesma loja", async () => {
    const ip = "10.4.9.9";
    for (let i = 0; i < 10; i++) expect((await send(ok, { ip })).status).toBe(201);
    expect((await send(ok, { ip })).status).toBe(429);
  });
});
