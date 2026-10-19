import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { PlanLimitError } from "./entitlements";
import { MAX_PIX_DISCOUNT, SettingsError, getCredentialStatus, getSettings, getStoreCredentials, setCredentials, updateSettings } from "./storeSettings";
import { acceptInvite, inviteStaff, listInvites, listTeam, peekInvite, removeMember, revokeInvite } from "./team";
import { getDomain, setDomain, validateCustomHost, verifyDomain } from "./customDomain";

let tag: string;
let planId: string;
let storeId: string;
let ownerId: string;
const storeIds: string[] = [];
const accountIds: string[] = [];
const SECRET = "APP_USR-1234567890-segredo-real-XYZ9";

const acc = async (k: string) => {
  const a = await prisma.account.create({ data: { name: k, email: `${k}-${tag}@t.local`, passwordHash: "x" } });
  accountIds.push(a.id);
  return a;
};
beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.create({ data: { name: `T11-${tag}`, priceCents: 1, staffLimit: 3, customDomain: true, advancedMetrics: false, csvExport: false } })).id;
  ownerId = (await acc("own")).id;
  const s = await prisma.store.create({
    data: { slug: `t11-${tag}`, name: "s", planId, members: { create: [{ accountId: ownerId, role: "OWNER" }] },
      settings: { create: [{ key: "originCep", value: "37175000" }, { key: "pixDiscountPercent", value: "0" }] } },
  });
  storeIds.push(s.id);
  storeId = s.id;
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: storeIds.splice(0) } } });
  await prisma.account.deleteMany({ where: { id: { in: accountIds.splice(0) } } });
  await prisma.plan.deleteMany({ where: { id: planId } });
});
afterAll(() => prisma.$disconnect());

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof SettingsError ? `${e.status} ${e.code}` : e instanceof PlanLimitError ? e.code : String(e)));

describe("configuracoes", () => {
  it("desconto Pix: teto de 50%", async () => {
    await updateSettings(storeId, { pixDiscountPercent: MAX_PIX_DISCOUNT });
    expect((await getSettings(storeId)).pixDiscountPercent).toBe(50);
  });
  it("le padrao e atualiza CEP (normalizado) e desconto Pix", async () => {
    expect(await getSettings(storeId)).toEqual({ originCep: "37175000", pixDiscountPercent: 0 });
    await updateSettings(storeId, { originCep: "01310-100", pixDiscountPercent: 5 });
    expect(await getSettings(storeId)).toEqual({ originCep: "01310100", pixDiscountPercent: 5 });
  });
  it("padrao quando a linha nao existe", async () => {
    await prisma.storeSetting.deleteMany({ where: { storeId } });
    expect(await getSettings(storeId)).toEqual({ originCep: "37175000", pixDiscountPercent: 0 });
    await updateSettings(storeId, { pixDiscountPercent: 10 });
    expect(await getSettings(storeId)).toEqual({ originCep: "37175000", pixDiscountPercent: 10 });
  });
  it("CEP invalido e desconto fora de 0..50 ou fracionado -> 400", async () => {
    expect(await code(updateSettings(storeId, { originCep: "123" }))).toBe("400 CEP_INVALID");
    for (const p of [-1, 51, 101, 2.5, NaN]) expect(await code(updateSettings(storeId, { pixDiscountPercent: p }))).toBe("400 PIX_DISCOUNT_INVALID");
    expect(await getSettings(storeId)).toEqual({ originCep: "37175000", pixDiscountPercent: 0 });
  });
});

describe("credenciais", () => {
  it("grava cifrado, status so com configured/last4, leitura interna decifra", async () => {
    expect(await getCredentialStatus(storeId)).toEqual({
      mpAccessToken: { configured: false, last4: null }, mpPublicKey: { configured: false, last4: null },
      mpWebhookSecret: { configured: false, last4: null }, melhorEnvioToken: { configured: false, last4: null },
    });
    await setCredentials(storeId, { mpAccessToken: SECRET, melhorEnvioToken: "me-token-abcdef12" });
    const rows = await prisma.storeSetting.findMany({ where: { storeId } });
    expect(JSON.stringify(rows)).not.toContain(SECRET);
    const st = await getCredentialStatus(storeId);
    expect(st.mpAccessToken).toEqual({ configured: true, last4: "XYZ9" });
    expect(st.mpPublicKey).toEqual({ configured: false, last4: null });
    expect(JSON.stringify(st)).not.toContain(SECRET);
    expect(await getStoreCredentials(storeId)).toEqual({ mpAccessToken: SECRET, melhorEnvioToken: "me-token-abcdef12" });
  });
  it("linha que nao decifra: status mostra nao configurado e loga aviso (sem 500); uso interno falha", async () => {
    await setCredentials(storeId, { mpAccessToken: SECRET, mpPublicKey: "pk-1234567890" });
    await prisma.storeSetting.updateMany({ where: { storeId, key: "cred.mpAccessToken" }, data: { value: "lixo-corrompido" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const st = await getCredentialStatus(storeId);
    expect(st.mpAccessToken).toEqual({ configured: false, last4: null });
    expect(st.mpPublicKey).toEqual({ configured: true, last4: "7890" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).not.toContain("lixo");
    warn.mockRestore();
    await expect(getStoreCredentials(storeId)).rejects.toThrow();
  });
  it("vazio mantem, clear apaga, segredo curto nao mostra last4", async () => {
    await setCredentials(storeId, { mpAccessToken: SECRET, mpPublicKey: "abc" });
    await setCredentials(storeId, { mpAccessToken: "", mpPublicKey: "  " });
    expect(await getStoreCredentials(storeId)).toEqual({ mpAccessToken: SECRET, mpPublicKey: "abc" });
    expect((await getCredentialStatus(storeId)).mpPublicKey).toEqual({ configured: true, last4: null });
    await setCredentials(storeId, {}, ["mpAccessToken"]);
    expect(await getStoreCredentials(storeId)).toEqual({ mpPublicKey: "abc" });
  });
});

describe("equipe", () => {
  it("convida conta existente como STAFF; repetido 409; lista", async () => {
    const a = await acc("conv");
    await inviteStaff(storeId, `  CONV-${tag}@T.LOCAL `);
    expect(await prisma.storeMember.findUnique({ where: { storeId_accountId: { storeId, accountId: a.id } } })).toMatchObject({ role: "STAFF" });
    expect(await code(inviteStaff(storeId, a.email))).toBe("409 ALREADY_MEMBER");
    expect((await listTeam(storeId)).map((m) => m.role).sort()).toEqual(["OWNER", "STAFF"]);
  });
  it("convite para e-mail sem conta: token so no retorno, aceite cria conta STAFF, uso unico", async () => {
    const email = `novo-${tag}@t.local`;
    const inv = await inviteStaff(storeId, email);
    if (inv.status !== "INVITED") throw new Error("esperava convite");
    expect(JSON.stringify(await prisma.storeInvite.findMany({ where: { storeId } }))).not.toContain(inv.token);
    expect(await peekInvite(inv.token)).toEqual({ email, storeName: "s" });
    expect((await listInvites(storeId)).map((i) => i.email)).toEqual([email]);
    expect(await code(acceptInvite("token-invalido-qualquer", { name: "N", password: "senha-longa-1" }))).toBe("404 INVITE_INVALID");
    expect(await acceptInvite(inv.token, { name: "Novo", password: "senha-longa-1" })).toEqual({ email });
    const created = await prisma.account.findUniqueOrThrow({ where: { email } });
    accountIds.push(created.id);
    expect(created.passwordHash).not.toBe("senha-longa-1");
    expect(await prisma.storeMember.findUnique({ where: { storeId_accountId: { storeId, accountId: created.id } } })).toMatchObject({ role: "STAFF" });
    expect(await code(acceptInvite(inv.token, { name: "N", password: "senha-longa-1" }))).toBe("404 INVITE_INVALID");
    expect(await peekInvite(inv.token)).toBeNull();
  });
  it("convite: novo convite invalida o anterior; vencido invalido; revogar; limite no aceite", async () => {
    const email = `novo2-${tag}@t.local`;
    const a = await inviteStaff(storeId, email);
    const b = await inviteStaff(storeId, email, new Date(Date.now() - 8 * 86400_000));
    if (a.status !== "INVITED" || b.status !== "INVITED") throw new Error("esperava convite");
    expect(await peekInvite(a.token)).toBeNull();
    expect(await peekInvite(b.token)).toBeNull(); // criado "ha 8 dias": vencido
    const c = await inviteStaff(storeId, email);
    if (c.status !== "INVITED") throw new Error("esperava convite");
    const [pending] = await listInvites(storeId);
    await prisma.plan.update({ where: { id: planId }, data: { staffLimit: 1 } });
    expect(await code(acceptInvite(c.token, { name: "N", password: "senha-longa-1" }))).toBe("STAFF_LIMIT");
    expect(await prisma.account.findUnique({ where: { email } })).toBeNull();
    expect(await code(revokeInvite(storeId, pending.id))).toBe("ok");
    expect(await code(revokeInvite(storeId, pending.id))).toBe("404 INVITE_NOT_FOUND");
  });
  it("limite do plano: concorrencia no limite-1, so um entra", async () => {
    await prisma.plan.update({ where: { id: planId }, data: { staffLimit: 2 } });
    const [a, b, c] = [await acc("a"), await acc("b"), await acc("c")];
    const results = await Promise.all([a, b, c].map((x) => code(inviteStaff(storeId, x.email))));
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "STAFF_LIMIT")).toHaveLength(2);
    expect(await prisma.storeMember.count({ where: { storeId } })).toBe(2);
  });
  it("remove STAFF; nunca o OWNER nem a si mesmo; inexistente 404", async () => {
    const a = await acc("rm");
    await inviteStaff(storeId, a.email);
    expect(await code(removeMember(storeId, ownerId, "master-id"))).toBe("400 CANNOT_REMOVE_OWNER");
    expect(await code(removeMember(storeId, ownerId, ownerId))).toBe("400 CANNOT_REMOVE_SELF");
    expect(await code(removeMember(storeId, a.id, a.id))).toBe("400 CANNOT_REMOVE_SELF");
    expect(await code(removeMember(storeId, "nao-existe", ownerId))).toBe("404 MEMBER_NOT_FOUND");
    expect(await code(removeMember(storeId, a.id, ownerId))).toBe("ok");
    expect(await prisma.storeMember.count({ where: { storeId } })).toBe(1);
  });
});

describe("dominio proprio", () => {
  it("validateCustomHost", () => {
    expect(validateCustomHost("Loja.Exemplo.com.br.", "plataforma.com")).toBe("loja.exemplo.com.br");
    for (const bad of ["https://loja.com", "loja.com/x", "loja.com:8080", "loja", "-a.com", "a..com", "plataforma.com", "x.plataforma.com", "a.b.plataforma.com", "", "loja.123", `${"a".repeat(64)}.com`, "lo ja.com", "a@b.com"]) {
      expect(validateCustomHost(bad, "plataforma.com"), bad).toBeNull();
    }
  });
  it("grava normalizado, nao verificado; troca reseta; mesmo host mantem; global unico 409", async () => {
    const host = `loja-${tag}.com.br`;
    expect(await setDomain(storeId, `LOJA-${tag}.com.br`)).toMatchObject({ host, verified: false });
    await prisma.storeDomain.updateMany({ where: { storeId }, data: { verified: true } });
    expect(await setDomain(storeId, host)).toMatchObject({ verified: true });
    expect(await setDomain(storeId, `nova-${tag}.com.br`)).toMatchObject({ host: `nova-${tag}.com.br`, verified: false });
    expect(await prisma.storeDomain.count({ where: { storeId } })).toBe(1);
    const other = await prisma.store.create({ data: { slug: `t11b-${tag}`, name: "b", planId } });
    storeIds.push(other.id);
    expect(await code(setDomain(other.id, `nova-${tag}.com.br`))).toBe("409 DOMAIN_TAKEN");
    expect(await code(setDomain(storeId, "https://x.com"))).toBe("400 DOMAIN_INVALID");
  });
  it("pedido nao verificado de outra loja ha 7+ dias expira e libera o host; verificado nunca expira", async () => {
    const host = `disputa-${tag}.com.br`;
    const other = await prisma.store.create({ data: { slug: `t11c-${tag}`, name: "c", planId } });
    storeIds.push(other.id);
    await setDomain(other.id, host);
    const old = new Date(Date.now() - 8 * 86_400_000);
    await prisma.storeDomain.updateMany({ where: { storeId: other.id }, data: { createdAt: old, verified: true } });
    expect(await code(setDomain(storeId, host))).toBe("409 DOMAIN_TAKEN"); // verificado vence
    await prisma.storeDomain.updateMany({ where: { storeId: other.id }, data: { createdAt: new Date(), verified: false } });
    expect(await code(setDomain(storeId, host))).toBe("409 DOMAIN_TAKEN"); // pedido recente ainda segura
    await prisma.storeDomain.updateMany({ where: { storeId: other.id }, data: { createdAt: old } });
    expect(await setDomain(storeId, host)).toMatchObject({ host, verified: false });
    expect(await getDomain(other.id)).toMatchObject({ host: null });
  });
  it("plano rebaixado: verificar recusa (DOMAIN_NOT_ALLOWED) e nada muda", async () => {
    const host = `rebaixa-${tag}.com`;
    await setDomain(storeId, host);
    await prisma.plan.update({ where: { id: planId }, data: { customDomain: false } });
    expect(await code(verifyDomain(storeId, async () => ["cname.vercel-dns.com"]))).toBe("DOMAIN_NOT_ALLOWED");
    expect(await getDomain(storeId)).toMatchObject({ host, verified: false });
  });
  it("plano sem dominio proprio -> DOMAIN_NOT_ALLOWED", async () => {
    await prisma.plan.update({ where: { id: planId }, data: { customDomain: false } });
    expect(await code(setDomain(storeId, `x-${tag}.com`))).toBe("DOMAIN_NOT_ALLOWED");
  });
  it("verificar: CNAME certo verifica; errado ou erro de DNS nao; sem dominio 404", async () => {
    expect(await code(verifyDomain(storeId, async () => []))).toBe("404 DOMAIN_NOT_FOUND");
    const host = `v-${tag}.com`;
    await setDomain(storeId, host);
    const asked: string[] = [];
    expect(await verifyDomain(storeId, async (h) => { asked.push(h); return ["outro.example.com"]; })).toMatchObject({ verified: false });
    expect(await verifyDomain(storeId, async () => { throw Object.assign(new Error("x"), { code: "ENOTFOUND" }); })).toMatchObject({ verified: false });
    expect(await verifyDomain(storeId, async () => ["CNAME.Vercel-DNS.com."])).toMatchObject({ host, verified: true });
    expect(asked).toEqual([host]);
    expect(await getDomain(storeId)).toMatchObject({ host, verified: true, cnameTarget: "cname.vercel-dns.com" });
  });
});
