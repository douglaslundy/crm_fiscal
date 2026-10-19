import { Prisma, type Coupon, type CouponKind } from "@prisma/client";
import { z } from "zod";
import { dbForStore, type StoreDb } from "@/lib/db-store";
import { MAX_CENTS } from "./money";

export type CouponErrorCode =
  | "COUPON_INVALID" | "COUPON_EXHAUSTED" | "COUPON_MIN_SUBTOTAL" | "COUPON_ALREADY_USED" | "COUPON_CODE_TAKEN" | "COUPON_NOT_FOUND";

export class CouponError extends Error {
  name = "CouponError";
  constructor(readonly status: 400 | 404 | 409, readonly code: CouponErrorCode, readonly extra?: Record<string, unknown>) {
    super(code);
  }
}

type Tx = Parameters<Parameters<StoreDb["$transaction"]>[0]>[0];
type Db = StoreDb | Tx;

export const normalizeCode = (s: string) => s.trim().toUpperCase();
const CODE_RE = /^[A-Z0-9_-]{3,30}$/;

/** Desconto sobre o subtotal dos itens (nunca sobre o frete); nunca passa do subtotal. */
export function discountFor(c: Pick<Coupon, "kind" | "value">, subtotalCents: number): number {
  const raw = c.kind === "PERCENT" ? Math.floor((subtotalCents * c.value) / 100) : c.value;
  return Math.max(0, Math.min(raw, subtotalCents));
}

/**
 * Confere o cupom para este cliente e subtotal. Cupom desconhecido, inativo, fora da janela ou de outra loja = COUPON_INVALID
 * (mesma resposta, sem revelar quais codigos existem). Cada cliente usa o cupom uma vez (pedido cancelado libera).
 */
export async function validateCoupon(db: Db, rawCode: string, customerId: string, subtotalCents: number, now = new Date(), usageAlreadyTaken = false) {
  const code = normalizeCode(rawCode);
  const c = CODE_RE.test(code) ? await db.coupon.findFirst({ where: { code } }) : null;
  if (!c || !c.active || (c.startsAt && c.startsAt > now) || (c.expiresAt && c.expiresAt <= now)) throw new CouponError(400, "COUPON_INVALID");
  if (!usageAlreadyTaken && c.maxUses !== null && c.usedCount >= c.maxUses) throw new CouponError(409, "COUPON_EXHAUSTED");
  if (subtotalCents < c.minSubtotalCents) throw new CouponError(409, "COUPON_MIN_SUBTOTAL", { minSubtotalCents: c.minSubtotalCents });
  if (await db.order.count({ where: { couponId: c.id, customerId, status: { not: "CANCELED" } } }) > 0) throw new CouponError(409, "COUPON_ALREADY_USED");
  return { coupon: c, discountCents: discountFor(c, subtotalCents) };
}

/** Consome um uso (UPDATE condicional atomico). Esgotado entre a validacao e aqui = COUPON_EXHAUSTED. */
export async function redeemCoupon(tx: Tx, c: Pick<Coupon, "id" | "maxUses">): Promise<void> {
  const { count } = await tx.coupon.updateMany({
    where: { id: c.id, active: true, ...(c.maxUses === null ? {} : { usedCount: { lt: c.maxUses } }) },
    data: { usedCount: { increment: 1 } },
  });
  if (count === 0) throw new CouponError(409, "COUPON_EXHAUSTED");
}

/** Devolve o uso quando o pedido e cancelado. */
export async function releaseCoupon(tx: Tx, couponId: string): Promise<void> {
  await tx.coupon.updateMany({ where: { id: couponId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
}

// "" = sem data. AAAA-MM-DD = dia civil de Brasilia (inicio: 00:00; fim: o dia inteiro vale, expira na 00:00 do dia seguinte). ISO com fuso tambem vale.
const dateOf = (end: boolean) => z.union([z.literal(""), z.iso.date(), z.iso.datetime({ offset: true })]).nullable().transform((s) => {
  if (!s) return null;
  if (s.length > 10) return new Date(s);
  const d = new Date(`${s}T00:00:00.000-03:00`);
  return end ? new Date(d.getTime() + 86_400_000) : d;
});
const startsAtField = dateOf(false);
const expiresAtField = dateOf(true);
export const CouponBody = z.object({
  code: z.string().transform(normalizeCode).pipe(z.string().regex(CODE_RE)),
  kind: z.enum(["PERCENT", "FIXED"]),
  value: z.number().int().min(1).max(MAX_CENTS),
  minSubtotalCents: z.number().int().min(0).max(MAX_CENTS).default(0),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
  startsAt: startsAtField.default(null),
  expiresAt: expiresAtField.default(null),
  active: z.boolean().default(true),
}).refine((b) => b.kind !== "PERCENT" || b.value <= 100, { path: ["value"], message: "Percentual de 1 a 100" })
  .refine((b) => !b.startsAt || !b.expiresAt || b.startsAt < b.expiresAt, { path: ["expiresAt"], message: "Fim antes do início" });
export type CouponInput = z.infer<typeof CouponBody>;
/** Edicao: o codigo nao muda (pedidos guardam o codigo usado). */
export const CouponPatch = z.object({
  kind: z.enum(["PERCENT", "FIXED"]).optional(),
  value: z.number().int().min(1).max(MAX_CENTS).optional(),
  minSubtotalCents: z.number().int().min(0).max(MAX_CENTS).optional(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  startsAt: startsAtField.optional(),
  expiresAt: expiresAtField.optional(),
  active: z.boolean().optional(),
});

const SELECT = { id: true, code: true, kind: true, value: true, minSubtotalCents: true, maxUses: true, usedCount: true, startsAt: true, expiresAt: true, active: true, createdAt: true } as const;

export const listCoupons = (storeId: string) => dbForStore(storeId).coupon.findMany({ select: SELECT, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 500 });

export async function createCoupon(storeId: string, input: CouponInput) {
  try {
    return await dbForStore(storeId).coupon.create({ data: { storeId, ...input }, select: SELECT });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new CouponError(409, "COUPON_CODE_TAKEN");
    throw e;
  }
}

export async function updateCoupon(storeId: string, id: string, patch: z.infer<typeof CouponPatch>) {
  const db = dbForStore(storeId);
  const cur = await db.coupon.findFirst({ where: { id }, select: { kind: true, value: true, startsAt: true, expiresAt: true } });
  if (!cur) throw new CouponError(404, "COUPON_NOT_FOUND");
  const next = { ...cur, ...patch } as { kind: CouponKind; value: number; startsAt: Date | null; expiresAt: Date | null };
  if ((next.kind === "PERCENT" && next.value > 100) || (next.startsAt && next.expiresAt && next.startsAt >= next.expiresAt)) throw new CouponError(400, "COUPON_INVALID");
  await db.coupon.updateMany({ where: { id }, data: patch });
  return db.coupon.findFirstOrThrow({ where: { id }, select: SELECT });
}

export async function deleteCoupon(storeId: string, id: string): Promise<void> {
  const { count } = await dbForStore(storeId).coupon.deleteMany({ where: { id } });
  if (count === 0) throw new CouponError(404, "COUPON_NOT_FOUND");
}
