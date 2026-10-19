import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { dbForStore } from "@/lib/db-store";

vi.mock("@/auth", async (orig) => ({ ...(await orig<typeof import("@/auth")>()), getSession: vi.fn() }));
const auth = await import("@/auth");
const { authorizeAccount, authorizeCustomer, authOptions } = auth;
const { requireCustomer, requireMaster, requireStoreMember } = await import("@/lib/guards");
const { POST: register } = await import("@/app/api/register-customer/route");

const getSession = vi.mocked(auth.getSession);
const PW = "senha-forte-1";
let tag: string;
let A: { id: string; slug: string };
let B: { id: string; slug: string };
const stores: string[] = [];
const accounts: string[] = [];

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  const planId = (await prisma.plan.upsert({
    where: { name: "Teste-Auth" },
    update: {},
    create: { name: "Teste-Auth", priceCents: 0, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  A = await prisma.store.create({ data: { slug: `auth-a-${tag}`, name: "A", planId } });
  B = await prisma.store.create({ data: { slug: `auth-b-${tag}`, name: "B", planId } });
  stores.push(A.id, B.id);
});
afterEach(async () => {
  getSession.mockReset();
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } }); // cascata leva clientes e membros
  await prisma.account.deleteMany({ where: { id: { in: accounts.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Auth" } }); // schema.test conta os planos
  await prisma.$disconnect();
});

const host = (s: { slug: string }) => `${s.slug}.localhost`;
const passwordHash = () => bcrypt.hash(PW, 4);

async function customer(storeId: string, email: string) {
  return dbForStore(storeId).customer.create({
    data: { storeId, name: "C", email, cpf: "52998224725", phone: "11999999999", passwordHash: await passwordHash() },
  });
}
async function account(isMaster = false) {
  const a = await prisma.account.create({ data: { name: "Conta", email: `conta-${tag}-${accounts.length}@t.local`, isMaster, passwordHash: await passwordHash() } });
  accounts.push(a.id);
  return a;
}

/** Roda o mesmo caminho do Auth.js: usuario do authorize -> jwt -> session. */
async function sessionOf(user: object | null): Promise<Session> {
  expect(user).not.toBeNull();
  const token = await authOptions.callbacks!.jwt!({ token: {}, user: user as never } as never);
  return authOptions.callbacks!.session!({ session: { expires: "x" }, token } as never) as Promise<Session>;
}
async function expectRedirect(p: Promise<unknown>, path: string) {
  await expect(p).rejects.toMatchObject({ digest: expect.stringContaining(`;${path};`) });
}

describe("provedor customer", () => {
  it("login na loja A vale so na loja A", async () => {
    await customer(A.id, `c-${tag}@t.local`);
    const s = await sessionOf(await authorizeCustomer({ email: ` C-${tag}@T.local `, password: PW }, host(A)));
    expect(s.user).toMatchObject({ kind: "customer", storeId: A.id });
    expect(JSON.stringify(s)).not.toContain("passwordHash");
    getSession.mockResolvedValue(s);
    await expect(requireCustomer(A.id)).resolves.toBe(s);
    await expectRedirect(requireCustomer(B.id), "/loja-entrar");
    await expectRedirect(requireCustomer(B.id, "/checkout"), "/loja-entrar?next=%2Fcheckout");
    await expectRedirect(requireMaster(), "/entrar");
    await expectRedirect(requireStoreMember(A.id), "/entrar");
  });
  it("mesmo email em duas lojas sao contas independentes", async () => {
    const email = `dup-${tag}@t.local`;
    const ca = await customer(A.id, email);
    const cb = await customer(B.id, email);
    await dbForStore(B.id).customer.update({ where: { id: cb.id }, data: { passwordHash: await bcrypt.hash("outra-senha-9", 4) } });
    expect((await authorizeCustomer({ email, password: PW }, host(A)))?.id).toBe(ca.id);
    expect(await authorizeCustomer({ email, password: PW }, host(B))).toBeNull();
    expect((await authorizeCustomer({ email, password: "outra-senha-9" }, host(B)))?.id).toBe(cb.id);
  });
  it("senha errada e email inexistente dao o mesmo resultado", async () => {
    await customer(A.id, `c-${tag}@t.local`);
    const wrong = await authorizeCustomer({ email: `c-${tag}@t.local`, password: "errada-123" }, host(A));
    const unknown = await authorizeCustomer({ email: `ninguem-${tag}@t.local`, password: PW }, host(A));
    expect(wrong).toBeNull();
    expect(unknown).toEqual(wrong);
  });
  it("host da plataforma ou desconhecido nao autentica cliente", async () => {
    await customer(A.id, `c-${tag}@t.local`);
    expect(await authorizeCustomer({ email: `c-${tag}@t.local`, password: PW }, "localhost")).toBeNull();
    expect(await authorizeCustomer({ email: `c-${tag}@t.local`, password: PW }, undefined)).toBeNull();
  });
  it("loja suspensa ou cancelada: login recusado e sessao existente barrada; TRIAL e ACTIVE passam", async () => {
    await customer(A.id, `c-${tag}@t.local`);
    const creds = { email: `c-${tag}@t.local`, password: PW };
    const s = await sessionOf(await authorizeCustomer(creds, host(A)));
    getSession.mockResolvedValue(s);
    for (const status of ["SUSPENDED", "CANCELED"] as const) {
      await prisma.store.update({ where: { id: A.id }, data: { status } });
      expect(await authorizeCustomer(creds, host(A))).toBeNull();
      await expectRedirect(requireCustomer(A.id), "/loja-entrar");
    }
    for (const status of ["TRIAL", "ACTIVE"] as const) {
      await prisma.store.update({ where: { id: A.id }, data: { status } });
      expect(await authorizeCustomer(creds, host(A))).not.toBeNull();
      await expect(requireCustomer(A.id)).resolves.toBe(s);
    }
  });
});

describe("provedor account e guardas", () => {
  it("senha errada e email inexistente dao o mesmo resultado", async () => {
    const a = await account();
    expect((await authorizeAccount({ email: a.email.toUpperCase(), password: PW }))?.id).toBe(a.id);
    const wrong = await authorizeAccount({ email: a.email, password: "errada-123" });
    expect(wrong).toBeNull();
    expect(await authorizeAccount({ email: `ninguem-${tag}@t.local`, password: PW })).toEqual(wrong);
  });
  it("requireMaster aceita master e rejeita conta comum e sem sessao", async () => {
    const m = await sessionOf(await authorizeAccount({ email: (await account(true)).email, password: PW }));
    getSession.mockResolvedValue(m);
    await expect(requireMaster()).resolves.toBe(m);
    getSession.mockResolvedValue(await sessionOf(await authorizeAccount({ email: (await account()).email, password: PW })));
    await expectRedirect(requireMaster(), "/entrar");
    getSession.mockResolvedValue(null);
    await expectRedirect(requireMaster(), "/entrar");
  });
  it("requireMaster consulta o banco: master rebaixado perde acesso", async () => {
    const a = await account(true);
    getSession.mockResolvedValue(await sessionOf(await authorizeAccount({ email: a.email, password: PW })));
    await prisma.account.update({ where: { id: a.id }, data: { isMaster: false } });
    await expectRedirect(requireMaster(), "/entrar");
  });
  it("requireStoreMember: membro da loja, papel OWNER, outra loja e master", async () => {
    const staff = await account();
    await prisma.storeMember.create({ data: { storeId: A.id, accountId: staff.id, role: "STAFF" } });
    const s = await sessionOf(await authorizeAccount({ email: staff.email, password: PW }));
    getSession.mockResolvedValue(s);
    await expect(requireStoreMember(A.id)).resolves.toBe(s);
    await expectRedirect(requireStoreMember(A.id, "OWNER"), "/entrar");
    await expectRedirect(requireStoreMember(B.id), "/entrar");
    await expectRedirect(requireCustomer(A.id), "/loja-entrar");

    getSession.mockResolvedValue(await sessionOf(await authorizeAccount({ email: (await account(true)).email, password: PW })));
    await expect(requireStoreMember(B.id, "OWNER")).resolves.toBeTruthy();
  });
});

describe("POST /api/register-customer", () => {
  const body = (email: string, extra: object = {}) => ({ name: "Maria", email, cpf: "529.982.247-25", phone: "11 99999-0000", password: PW, ...extra });
  const post = (h: string | null, data: unknown) =>
    register(new Request("http://x/api/register-customer", {
      method: "POST",
      headers: { "content-type": "application/json", ...(h ? { "x-store-host": h } : {}) },
      body: JSON.stringify(data),
    }));

  it("cria cliente na loja do host, normaliza e nunca devolve hash", async () => {
    const res = await post(host(A), body(` Maria-${tag}@T.Local `));
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toMatch(/passwordHash|\$2[aby]\$/);
    const c = await dbForStore(A.id).customer.findUniqueOrThrow({ where: { storeId_email: { storeId: A.id, email: `maria-${tag}@t.local` } } });
    expect(c.cpf).toBe("52998224725");
    expect(await bcrypt.compare(PW, c.passwordHash)).toBe(true);
    expect(JSON.parse(text)).toEqual({ id: c.id, name: "Maria", email: c.email });
  });
  it("409 para email repetido na mesma loja; outra loja aceita", async () => {
    expect((await post(host(A), body(`r-${tag}@t.local`))).status).toBe(201);
    const dup = await post(host(A), body(`R-${tag}@t.local`));
    expect(dup.status).toBe(409);
    expect(await dup.text()).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect((await post(host(B), body(`r-${tag}@t.local`))).status).toBe(201);
  });
  it("400 para CPF invalido, senha curta e email invalido", async () => {
    expect((await post(host(A), body(`x-${tag}@t.local`, { cpf: "111.111.111-11" }))).status).toBe(400);
    expect((await post(host(A), body(`x-${tag}@t.local`, { password: "1234567" }))).status).toBe(400);
    expect((await post(host(A), body("nao-e-email"))).status).toBe(400);
    expect(await dbForStore(A.id).customer.count()).toBe(0);
  });
  it("404 sem loja no host; 403 para loja suspensa ou cancelada", async () => {
    expect((await post(null, body(`x-${tag}@t.local`))).status).toBe(404);
    expect((await post("nao-existe.localhost", body(`x-${tag}@t.local`))).status).toBe(404);
    for (const status of ["SUSPENDED", "CANCELED"] as const) {
      await prisma.store.update({ where: { id: A.id }, data: { status } });
      expect((await post(host(A), body(`x-${tag}@t.local`))).status).toBe(403);
    }
    expect(await dbForStore(A.id).customer.count()).toBe(0);
  });
});
