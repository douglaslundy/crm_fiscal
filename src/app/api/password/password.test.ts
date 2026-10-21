import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeSender } from "@/integrations/email";
import { STORE_HOST_HEADER } from "@/lib/host";
import { POST as forgot } from "./forgot/route";
import { POST as reset } from "./reset/route";

let tag: string;
let planId: string;
const stores: string[] = [];
const accounts: string[] = [];

const post = (url: string, body: unknown, host?: string) =>
  new Request(`http://x.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://x.test", "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(host ? { [STORE_HOST_HEADER]: host } : {}) },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  process.env.PLATFORM_DOMAIN = "plat.test";
  process.env.NEXTAUTH_URL = "https://plat.test";
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-PwApi" }, update: {},
    create: { name: "Teste-PwApi", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  fakeSender.sent.length = 0;
});
afterEach(async () => {
  await prisma.passwordReset.deleteMany({});
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
  await prisma.account.deleteMany({ where: { id: { in: accounts.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-PwApi" } });
  await prisma.$disconnect();
});

describe("POST /api/password/forgot e /reset", () => {
  it("conta da plataforma: e-mail com link da plataforma; troca a senha; mesma resposta para e-mail inexistente", async () => {
    const a = await prisma.account.create({ data: { email: `a-${tag}@t.local`, name: "Ana", passwordHash: bcrypt.hashSync("antiga-123", 4) } });
    accounts.push(a.id);
    const unknown = await forgot(post("/api/password/forgot", { email: `nao-${tag}@t.local` }));
    expect([unknown.status, await unknown.json(), fakeSender.sent.length]).toEqual([200, { ok: true }, 0]);
    const ok = await forgot(post("/api/password/forgot", { email: a.email }));
    expect([ok.status, await ok.json()]).toEqual([200, { ok: true }]);
    const link = /https:\/\/plat\.test\/redefinir-senha\/(\S+)/.exec(fakeSender.sent[0].text);
    expect(link).not.toBeNull();
    const done = await reset(post("/api/password/reset", { token: link![1], password: "nova-senha-123" }));
    expect(done.status).toBe(200);
    expect(await bcrypt.compare("nova-senha-123", (await prisma.account.findUniqueOrThrow({ where: { id: a.id } })).passwordHash)).toBe(true);
    expect((await reset(post("/api/password/reset", { token: link![1], password: "nova-senha-123" }))).status).toBe(400);
  });
  it("cliente da loja: link no subdominio da loja; conta de outro mundo nao recebe", async () => {
    const s = await prisma.store.create({ data: { slug: `pw-${tag}`, name: "Loja Pw", planId } });
    stores.push(s.id);
    const c = await prisma.customer.create({ data: { storeId: s.id, name: "Cli", email: `c-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } });
    const acc = await prisma.account.create({ data: { email: `dono-${tag}@t.local`, name: "Dono", passwordHash: "x" } });
    accounts.push(acc.id);
    const host = `pw-${tag}.plat.test`;
    await forgot(post("/api/password/forgot", { email: acc.email }, host)); // e-mail de conta em host de loja: nao e cliente
    expect(fakeSender.sent).toHaveLength(0);
    await forgot(post("/api/password/forgot", { email: c.email }, host));
    expect(fakeSender.sent[0].text).toContain(`https://pw-${tag}.plat.test/redefinir-senha/`);
  });
  it("valida entrada: e-mail invalido, senha curta, host de loja desconhecido, sem origem", async () => {
    expect((await forgot(post("/api/password/forgot", { email: "x" }))).status).toBe(400);
    expect((await reset(post("/api/password/reset", { token: "x".repeat(30), password: "curta" }))).status).toBe(400);
    expect((await forgot(post("/api/password/forgot", { email: "a@t.local" }, "nao-existe.plat.test"))).status).toBe(404);
    const noOrigin = new Request("http://x.test/api/password/forgot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@t.local" }) });
    expect((await forgot(noOrigin)).status).toBe(403);
  });
});
