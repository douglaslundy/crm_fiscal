import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const ForgotBody = z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) });
export const ResetBody = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(72), // bcrypt ignora alem de 72 bytes
});

export class ResetTokenError extends Error {
  name = "ResetTokenError";
}

const TTL_MS = 60 * 60_000;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export type ResetRequest = { token: string; email: string; name: string };

/**
 * Gera um token de uso unico (1h) se existir a conta (kind ACCOUNT) ou o cliente da loja (kind CUSTOMER, `storeId` obrigatorio).
 * Devolve null quando nao existe: quem chama responde igual nos dois casos (nao revela quais e-mails tem conta).
 * Pedido novo invalida os anteriores ainda nao usados.
 */
export async function requestReset(kind: "ACCOUNT" | "CUSTOMER", email: string, storeId: string | null, now = new Date()): Promise<ResetRequest | null> {
  const subject = kind === "ACCOUNT"
    ? await prisma.account.findUnique({ where: { email }, select: { id: true, name: true } })
    : storeId ? await prisma.customer.findUnique({ where: { storeId_email: { storeId, email } }, select: { id: true, name: true } }) : null;
  if (!subject) return null;
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.passwordReset.deleteMany({ where: { kind, subjectId: subject.id, usedAt: null } }),
    prisma.passwordReset.create({ data: { tokenHash: hashToken(token), kind, subjectId: subject.id, expiresAt: new Date(now.getTime() + TTL_MS) } }),
  ]);
  return { token, email, name: subject.name };
}

/** Consome o token (UPDATE condicional: uso unico mesmo em corrida) e troca a senha. Token invalido, usado ou vencido: ResetTokenError. */
export async function resetPassword(token: string, password: string, now = new Date()): Promise<void> {
  const tokenHash = hashToken(token);
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.passwordReset.updateMany({ where: { tokenHash, kind: { in: ["ACCOUNT", "CUSTOMER"] }, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (count === 0) throw new ResetTokenError("Link inválido ou vencido");
    const r = await tx.passwordReset.findUniqueOrThrow({ where: { tokenHash }, select: { kind: true, subjectId: true } });
    if (r.kind === "ACCOUNT") await tx.account.update({ where: { id: r.subjectId }, data: { passwordHash, passwordChangedAt: now } });
    else await tx.customer.update({ where: { id: r.subjectId }, data: { passwordHash, passwordChangedAt: now } });
  });
}

const VERIFY_TTL_MS = 7 * 24 * 60 * 60_000;

/** Token de confirmacao de e-mail (7 dias, uso unico). Mesma tabela da redefinicao, kinds VERIFY_*: nunca serve para trocar senha. */
export async function requestEmailVerification(kind: "ACCOUNT" | "CUSTOMER", subjectId: string, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const k = `VERIFY_${kind}`;
  await prisma.$transaction([
    prisma.passwordReset.deleteMany({ where: { kind: k, subjectId, usedAt: null } }),
    prisma.passwordReset.create({ data: { tokenHash: hashToken(token), kind: k, subjectId, expiresAt: new Date(now.getTime() + VERIFY_TTL_MS) } }),
  ]);
  return token;
}

/** Consome o token e marca o e-mail como confirmado. Invalido, usado ou vencido: ResetTokenError. */
export async function verifyEmail(token: string, now = new Date()): Promise<void> {
  const tokenHash = hashToken(token);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.passwordReset.updateMany({ where: { tokenHash, kind: { in: ["VERIFY_ACCOUNT", "VERIFY_CUSTOMER"] }, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (count === 0) throw new ResetTokenError("Link inválido ou vencido");
    const r = await tx.passwordReset.findUniqueOrThrow({ where: { tokenHash }, select: { kind: true, subjectId: true } });
    if (r.kind === "VERIFY_ACCOUNT") await tx.account.update({ where: { id: r.subjectId }, data: { emailVerifiedAt: now } });
    else await tx.customer.update({ where: { id: r.subjectId }, data: { emailVerifiedAt: now } });
  });
}
