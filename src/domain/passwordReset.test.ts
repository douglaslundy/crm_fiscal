import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeSender } from "@/integrations/email";
import { passwordVersion } from "@/auth";
import { sendInviteEmail, sendPasswordResetEmail } from "./notifications";
import { ForgotBody, ResetBody, ResetTokenError, requestEmailVerification, requestReset, resetPassword, verifyEmail } from "./passwordReset";

let tag: string;
let planId: string;
const stores: string[] = [];
const accounts: string[] = [];

const mkStore = async (k: string) => {
  const s = await prisma.store.create({ data: { slug: `pwr-${k}-${tag}`, name: `Loja ${k}`, planId } });
  stores.push(s.id);
  return s.id;
};
const mkAccount = async (k: string) => {
  const a = await prisma.account.create({ data: { email: `${k}-${tag}@t.local`, name: "Dono Silva", passwordHash: await bcrypt.hash("senha-antiga", 4) } });
  accounts.push(a.id);
  return a;
};
const mkCustomer = (storeId: string, k: string) =>
  prisma.customer.create({ data: { storeId, name: "Cli Souza", email: `${k}-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: OLD_HASH } });
const OLD_HASH = bcrypt.hashSync("senha-antiga", 4);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof ResetTokenError ? "TOKEN" : String(e)));

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-Pwr" }, update: {},
    create: { name: "Teste-Pwr", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  fakeSender.sent.length = 0;
});
afterEach(async () => {
  await prisma.passwordReset.deleteMany({});
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
  await prisma.account.deleteMany({ where: { id: { in: accounts.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Pwr" } });
  await prisma.$disconnect();
});

describe("redefinicao de senha", () => {
  it("conta: token troca a senha uma unica vez; so o hash fica no banco", async () => {
    const a = await mkAccount("a");
    const r = await requestReset("ACCOUNT", a.email, null);
    expect(r).toMatchObject({ email: a.email, name: "Dono Silva" });
    expect(JSON.stringify(await prisma.passwordReset.findMany())).not.toContain(r!.token);
    expect(await code(resetPassword(r!.token, "nova-senha-123"))).toBe("ok");
    const row = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
    expect(await bcrypt.compare("nova-senha-123", row.passwordHash)).toBe(true);
    expect(await code(resetPassword(r!.token, "outra-senha-456"))).toBe("TOKEN");
  });
  it("cliente: so da loja informada; mesmo e-mail em outra loja nao e afetado", async () => {
    const [s1, s2] = [await mkStore("1"), await mkStore("2")];
    const c1 = await mkCustomer(s1, "c");
    const c2 = await mkCustomer(s2, "c");
    expect(await requestReset("CUSTOMER", c1.email, null)).toBeNull();
    const r = await requestReset("CUSTOMER", c1.email, s1);
    await resetPassword(r!.token, "nova-senha-123");
    expect(await bcrypt.compare("nova-senha-123", (await prisma.customer.findUniqueOrThrow({ where: { id: c1.id } })).passwordHash)).toBe(true);
    expect(await bcrypt.compare("senha-antiga", (await prisma.customer.findUniqueOrThrow({ where: { id: c2.id } })).passwordHash)).toBe(true);
  });
  it("e-mail sem conta: null (nada gravado); token invalido ou vencido: recusado", async () => {
    expect(await requestReset("ACCOUNT", `nao-existe-${tag}@t.local`, null)).toBeNull();
    expect(await prisma.passwordReset.count()).toBe(0);
    expect(await code(resetPassword("x".repeat(43), "nova-senha-123"))).toBe("TOKEN");
    const a = await mkAccount("v");
    const r = await requestReset("ACCOUNT", a.email, null, new Date(Date.now() - 2 * 3600_000)); // pedido ha 2h: venceu
    expect(await code(resetPassword(r!.token, "nova-senha-123"))).toBe("TOKEN");
  });
  it("novo pedido invalida o anterior; uso simultaneo do mesmo token troca so uma vez", async () => {
    const a = await mkAccount("n");
    const old = await requestReset("ACCOUNT", a.email, null);
    const fresh = await requestReset("ACCOUNT", a.email, null);
    expect(await code(resetPassword(old!.token, "nova-senha-123"))).toBe("TOKEN");
    const res = await Promise.all([1, 2, 3].map(() => code(resetPassword(fresh!.token, "nova-senha-123"))));
    expect(res.filter((x) => x === "ok")).toHaveLength(1);
  });
  it("schemas: e-mail normalizado; senha de 8 a 72", () => {
    expect(ForgotBody.parse({ email: " A@T.Local " }).email).toBe("a@t.local");
    expect(ResetBody.safeParse({ token: "x".repeat(30), password: "1234567" }).success).toBe(false);
    expect(ResetBody.safeParse({ token: "x".repeat(30), password: "x".repeat(73) }).success).toBe(false);
    expect(ResetBody.safeParse({ token: "x".repeat(30), password: "12345678" }).success).toBe(true);
  });
});

describe("e-mails", () => {
  it("redefinicao e convite chegam ao destinatario com o link", async () => {
    await sendPasswordResetEmail("a@t.local", "Ana Maria", "https://x/redefinir-senha/tok");
    await sendInviteEmail("b@t.local", "Loja X", "https://x/convite/tok");
    expect(fakeSender.sent.map((m) => [m.to, m.text.includes("/tok")])).toEqual([["a@t.local", true], ["b@t.local", true]]);
    expect(fakeSender.sent[0].text).toContain("Olá, Ana.");
  });
});

describe("confirmacao de e-mail", () => {
  it("confirma uma vez; conta e cliente; token de confirmacao nao troca senha", async () => {
    const a = await mkAccount("ve");
    const c = await mkCustomer(await mkStore("ve"), "ve");
    const ta = await requestEmailVerification("ACCOUNT", a.id);
    const tc = await requestEmailVerification("CUSTOMER", c.id);
    expect(await code(resetPassword(ta, "nova-senha-123"))).toBe("TOKEN");
    expect(await code(verifyEmail(ta))).toBe("ok");
    expect(await code(verifyEmail(ta))).toBe("TOKEN");
    expect(await code(verifyEmail(tc))).toBe("ok");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: a.id } })).emailVerifiedAt).not.toBeNull();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).emailVerifiedAt).not.toBeNull();
  });
  it("token de redefinicao nao confirma e-mail; vencido e recusado", async () => {
    const a = await mkAccount("vx");
    const r = await requestReset("ACCOUNT", a.email, null);
    expect(await code(verifyEmail(r!.token))).toBe("TOKEN");
    const old = await requestEmailVerification("ACCOUNT", a.id, new Date(Date.now() - 8 * 24 * 3600_000));
    expect(await code(verifyEmail(old))).toBe("TOKEN");
  });
});

describe("invalidacao de sessao", () => {
  it("trocar a senha muda a versao da senha (sessoes antigas deixam de valer); conta inexistente: null", async () => {
    const a = await mkAccount("pv");
    const c = await mkCustomer(await mkStore("pv"), "pv");
    expect([await passwordVersion("account", a.id), await passwordVersion("customer", c.id)]).toEqual([0, 0]);
    const ra = await requestReset("ACCOUNT", a.email, null);
    await resetPassword(ra!.token, "nova-senha-123");
    expect(await passwordVersion("account", a.id)).toBeGreaterThan(0);
    expect(await passwordVersion("customer", c.id)).toBe(0);
    expect(await passwordVersion("account", "nao-existe")).toBeNull();
  });
});
