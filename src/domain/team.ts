import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { MemberRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertCanAddStaff } from "./entitlements";
import { SettingsError } from "./storeSettings";

// StoreMember/Account sao tabelas de plataforma: prisma direto, sempre filtrando por storeId.

export async function listTeam(storeId: string): Promise<{ accountId: string; name: string; email: string; role: MemberRole }[]> {
  const rows = await prisma.storeMember.findMany({ where: { storeId }, include: { account: { select: { name: true, email: true } } }, orderBy: { role: "asc" } });
  return rows.map((m) => ({ accountId: m.accountId, name: m.account.name, email: m.account.email, role: m.role }));
}

const INVITE_TTL_MS = 7 * 86400_000;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export type InviteResult = { status: "ADDED" } | { status: "INVITED"; token: string };

/**
 * Conta existente entra direto como STAFF. E-mail sem conta gera convite de 7 dias (token so no link devolvido aqui; no banco fica o hash;
 * novo convite para o mesmo e-mail invalida o anterior). Trava a loja: checagem de limite + insercao sao atomicas.
 */
export async function inviteStaff(storeId: string, rawEmail: string, now = new Date()): Promise<InviteResult> {
  const email = rawEmail.trim().toLowerCase();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
    const account = await tx.account.findUnique({ where: { email }, select: { id: true } });
    if (account && await tx.storeMember.findUnique({ where: { storeId_accountId: { storeId, accountId: account.id } } })) throw new SettingsError(409, "ALREADY_MEMBER");
    await assertCanAddStaff(storeId, tx);
    if (account) {
      await tx.storeMember.create({ data: { storeId, accountId: account.id, role: "STAFF" } });
      return { status: "ADDED" as const };
    }
    const token = randomBytes(32).toString("base64url");
    await tx.storeInvite.deleteMany({ where: { storeId, email } });
    await tx.storeInvite.create({ data: { storeId, email, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + INVITE_TTL_MS) } });
    return { status: "INVITED" as const, token };
  });
}

/** Convites pendentes (nao vencidos) da loja; o token nunca volta. */
export const listInvites = (storeId: string, now = new Date()) =>
  prisma.storeInvite.findMany({ where: { storeId, expiresAt: { gt: now } }, select: { id: true, email: true, expiresAt: true }, orderBy: { createdAt: "asc" } });

export async function revokeInvite(storeId: string, inviteId: string): Promise<void> {
  const { count } = await prisma.storeInvite.deleteMany({ where: { id: inviteId, storeId } });
  if (count === 0) throw new SettingsError(404, "INVITE_NOT_FOUND");
}

/** Dados do convite para a pagina (sem consumir). null = invalido ou vencido. */
export async function peekInvite(token: string, now = new Date()) {
  const inv = await prisma.storeInvite.findUnique({ where: { tokenHash: hashToken(token) }, select: { email: true, expiresAt: true, store: { select: { name: true } } } });
  return inv && inv.expiresAt > now ? { email: inv.email, storeName: inv.store.name } : null;
}

/**
 * Consome o convite: cria a conta (nome e senha escolhidos) e a vincula como STAFF. Se a conta ja existe (criada depois do convite),
 * so vincula, sem mexer na senha. O token e de uso unico; limite do plano e rechecado na hora.
 */
export async function acceptInvite(token: string, input: { name: string; password: string }, now = new Date()): Promise<{ email: string }> {
  const passwordHash = await bcrypt.hash(input.password, 10);
  return prisma.$transaction(async (tx) => {
    const inv = await tx.storeInvite.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!inv || inv.expiresAt <= now) throw new SettingsError(404, "INVITE_INVALID");
    await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${inv.storeId} FOR UPDATE`;
    if ((await tx.storeInvite.deleteMany({ where: { id: inv.id } })).count === 0) throw new SettingsError(404, "INVITE_INVALID"); // consumido em paralelo
    await assertCanAddStaff(inv.storeId, tx);
    const account = await tx.account.findUnique({ where: { email: inv.email }, select: { id: true } })
      ?? await tx.account.create({ data: { name: input.name, email: inv.email, passwordHash }, select: { id: true } });
    await tx.storeMember.upsert({
      where: { storeId_accountId: { storeId: inv.storeId, accountId: account.id } },
      create: { storeId: inv.storeId, accountId: account.id, role: "STAFF" },
      update: {},
    });
    return { email: inv.email };
  });
}

/** Remove um STAFF. Nunca o OWNER nem quem esta removendo. */
export async function removeMember(storeId: string, accountId: string, actorId: string): Promise<void> {
  if (accountId === actorId) throw new SettingsError(400, "CANNOT_REMOVE_SELF");
  const m = await prisma.storeMember.findUnique({ where: { storeId_accountId: { storeId, accountId } } });
  if (!m) throw new SettingsError(404, "MEMBER_NOT_FOUND");
  if (m.role === "OWNER") throw new SettingsError(400, "CANNOT_REMOVE_OWNER");
  await prisma.storeMember.deleteMany({ where: { storeId, accountId, role: "STAFF" } });
}
