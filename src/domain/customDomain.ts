import { resolveCname } from "node:dns/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeHost, platformDomain } from "@/lib/host";
import { assertCanUseCustomDomain } from "./entitlements";
import { SettingsError } from "./storeSettings";

// v1: um dominio proprio por loja, verificado por CNAME. Registro na API de dominios da Vercel fica para depois (T20).

export const cnameTarget = () => process.env.PLATFORM_CNAME_TARGET || "cname.vercel-dns.com";

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Host normalizado ou null: sem esquema/caminho/porta, rotulos validos, TLD com letras, fora do dominio da plataforma. */
export function validateCustomHost(raw: string, platform: string): string | null {
  if (/[/:@?#\s]/.test(raw.trim())) return null;
  const h = normalizeHost(raw);
  const labels = h.split(".");
  if (h.length > 253 || labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !/^[a-z]{2,}$/.test(labels.at(-1)!)) return null;
  const d = normalizeHost(platform);
  return h === d || h.endsWith(`.${d}`) ? null : h;
}

export async function getDomain(storeId: string) {
  const d = await prisma.storeDomain.findFirst({ where: { storeId }, select: { host: true, verified: true } });
  return { host: d?.host ?? null, verified: d?.verified ?? false, cnameTarget: cnameTarget() };
}

/** Grava (ou troca) o dominio da loja. Host novo comeca nao verificado; o mesmo host mantem o estado. */
export async function setDomain(storeId: string, raw: string) {
  const host = validateCustomHost(raw, platformDomain());
  if (!host) throw new SettingsError(400, "DOMAIN_INVALID");
  await assertCanUseCustomDomain(storeId);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
      if (await tx.storeDomain.findFirst({ where: { storeId, host } })) return;
      await tx.storeDomain.deleteMany({ where: { storeId } });
      await tx.storeDomain.create({ data: { storeId, host } });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new SettingsError(409, "DOMAIN_TAKEN");
    throw e;
  }
  return getDomain(storeId);
}

export type CnameResolver = (host: string) => Promise<string[]>;

/** Consulta o CNAME do host; aponta para o alvo da plataforma -> verified=true, senao false (inclusive erro de DNS). */
export async function verifyDomain(storeId: string, resolve: CnameResolver = resolveCname) {
  const d = await prisma.storeDomain.findFirst({ where: { storeId } });
  if (!d) throw new SettingsError(404, "DOMAIN_NOT_FOUND");
  const target = normalizeHost(cnameTarget());
  const records = await resolve(d.host).catch(() => [] as string[]);
  const verified = records.some((r) => normalizeHost(r) === target);
  await prisma.storeDomain.updateMany({ where: { id: d.id, host: d.host }, data: { verified } });
  return getDomain(storeId);
}
