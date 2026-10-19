import type { MemberRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertCanAddStaff } from "./entitlements";
import { SettingsError } from "./storeSettings";

// StoreMember/Account sao tabelas de plataforma: prisma direto, sempre filtrando por storeId.

export async function listTeam(storeId: string): Promise<{ accountId: string; name: string; email: string; role: MemberRole }[]> {
  const rows = await prisma.storeMember.findMany({ where: { storeId }, include: { account: { select: { name: true, email: true } } }, orderBy: { role: "asc" } });
  return rows.map((m) => ({ accountId: m.accountId, name: m.account.name, email: m.account.email, role: m.role }));
}

/** Adiciona conta ja cadastrada como STAFF (v1 sem e-mail de convite). Trava a loja: checagem de limite + insercao sao atomicas. */
export async function inviteStaff(storeId: string, rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
    const account = await tx.account.findUnique({ where: { email }, select: { id: true } });
    if (!account) throw new SettingsError(404, "ACCOUNT_NOT_FOUND", "O usuário precisa se cadastrar primeiro");
    if (await tx.storeMember.findUnique({ where: { storeId_accountId: { storeId, accountId: account.id } } })) throw new SettingsError(409, "ALREADY_MEMBER");
    await assertCanAddStaff(storeId, tx);
    await tx.storeMember.create({ data: { storeId, accountId: account.id, role: "STAFF" } });
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
