import { z } from "zod";
import type { Order, OrderStatus, Prisma } from "@prisma/client";
import { dbForStore } from "@/lib/db-store";
import { cancelOrder, OrderNotFoundError } from "./orders";

export const ORDER_PAGE_SIZE = 20;
const MAX_PAGE = 1000;
const PAID_STATUSES: OrderStatus[] = ["PAID", "SHIPPED", "DELIVERED"];

export type AdminOrderCode = "INVALID_TRANSITION" | "REEMBOLSO_MANUAL" | "PAGAMENTO_EM_ABERTO";
const MESSAGES: Record<AdminOrderCode, string> = {
  INVALID_TRANSITION: "Transição de status não permitida para este pedido.",
  REEMBOLSO_MANUAL: "Pedido já pago não pode ser cancelado aqui: faça o reembolso pelo painel do Mercado Pago.",
  PAGAMENTO_EM_ABERTO: "Há um pagamento em andamento (Pix vigente ou cartão em análise). Aguarde o vencimento: o pedido é cancelado automaticamente se não for pago.",
};
export class AdminOrderError extends Error {
  name = "AdminOrderError";
  readonly status = 409;
  constructor(readonly code: AdminOrderCode) { super(MESSAGES[code]); }
}

export const OrderPatch = z.object({
  status: z.enum(["SHIPPED", "DELIVERED", "CANCELED"]).optional(),
  trackingCode: z.string().trim().max(60).optional(),
}).strict().refine((v) => v.status !== undefined || v.trackingCode !== undefined, "vazio")
  .refine((v) => !(v.status === "CANCELED" && v.trackingCode !== undefined), "cancelamento sem rastreio");
export type OrderPatchInput = z.infer<typeof OrderPatch>;

const FROM: Record<"SHIPPED" | "DELIVERED", OrderStatus> = { SHIPPED: "PAID", DELIVERED: "SHIPPED" };

/** Muda o status (so PAID->SHIPPED->DELIVERED) e/ou o rastreio; UPDATE condicional no status esperado (sem corrida). */
export async function updateOrder(storeId: string, orderId: string, input: OrderPatchInput): Promise<Order> {
  const parsed = OrderPatch.parse(input);
  const db = dbForStore(storeId);
  const order = await db.order.findFirst({ where: { id: orderId } });
  if (!order) throw new OrderNotFoundError("Pedido não encontrado");
  const tracking = parsed.trackingCode === undefined ? {} : { trackingCode: parsed.trackingCode || null };

  if (parsed.status === "CANCELED") {
    if (order.status !== "PENDING_PAYMENT") throw new AdminOrderError(order.status === "CANCELED" ? "INVALID_TRANSITION" : "REEMBOLSO_MANUAL");
    // pagamento que ainda pode compensar (Pix vigente ou cartao pendente sem Pix): cancelar aqui geraria PAID_FOR_CANCELED.
    // shortcut: checagem antes do cancelamento (nao atomica); um Pix criado no meio ainda cai no alerta existente.
    const live = order.pixExpiresAt ? order.pixExpiresAt > new Date() : order.mpPaymentId !== null;
    if (live) throw new AdminOrderError("PAGAMENTO_EM_ABERTO");
    if (!(await cancelOrder(storeId, orderId))) throw new AdminOrderError("INVALID_TRANSITION");
  } else {
    const where: Prisma.OrderWhereInput = parsed.status
      ? { id: orderId, status: FROM[parsed.status] }
      : { id: orderId, status: { in: ["SHIPPED", "DELIVERED"] } };
    const { count } = await db.order.updateMany({ where, data: { ...(parsed.status ? { status: parsed.status } : {}), ...tracking } });
    if (count === 0) throw new AdminOrderError("INVALID_TRANSITION");
  }
  return db.order.findFirstOrThrow({ where: { id: orderId } });
}

// dia que existe no calendario (2026-02-31 nao vira 03-03): ida e volta pela data UTC tem de dar o mesmo texto
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s));
/** Busca literal: o Prisma nao escapa os curingas do LIKE (% _ e a barra de escape). */
const literal = (q: string) => q.replace(/[\\%_]/g, "\\$&");
const Query = z.object({
  page: z.coerce.number().int().min(1).max(MAX_PAGE).optional(),
  status: z.enum(["PENDING_PAYMENT", "PAID", "SHIPPED", "DELIVERED", "CANCELED"]).optional(),
  from: Day.optional(), to: Day.optional(), q: z.string().trim().max(100).optional(),
});
export type OrderQuery = z.infer<typeof Query>;
type SP = URLSearchParams | Record<string, string | string[] | undefined>;

/** Query string -> filtros validados; invalido = null (a pagina ignora e avisa). */
export function parseListQuery(sp: SP, keys: readonly (keyof OrderQuery)[] = ["page", "status", "from", "to", "q"]): OrderQuery | null {
  const get = (k: string) => { const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k]; return (Array.isArray(v) ? v[0] : v) || undefined; };
  const r = Query.safeParse(Object.fromEntries(keys.map((k) => [k, get(k)])));
  return r.success ? (Object.fromEntries(Object.entries(r.data).filter(([, v]) => v !== undefined && v !== "")) as OrderQuery) : null;
}

const dayStart = (s: string) => new Date(`${s}T00:00:00.000-03:00`); // dia civil de Brasilia
const nextDay = (s: string) => new Date(dayStart(s).getTime() + 86_400_000);

export async function listOrders(storeId: string, query: OrderQuery) {
  const page = query.page ?? 1;
  const and: Prisma.OrderWhereInput[] = [];
  if (query.status) and.push({ status: query.status });
  if (query.from) and.push({ createdAt: { gte: dayStart(query.from) } });
  if (query.to) and.push({ createdAt: { lt: nextDay(query.to) } });
  if (query.q) {
    const q = literal(query.q);
    and.push({ OR: [
      { id: { startsWith: q, mode: "insensitive" } },
      { customer: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } },
    ] });
  }
  const db = dbForStore(storeId);
  const [items, total] = await Promise.all([
    db.order.findMany({
      where: { AND: and }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * ORDER_PAGE_SIZE, take: ORDER_PAGE_SIZE,
      select: { id: true, status: true, totalCents: true, createdAt: true, customer: { select: { name: true, email: true } } },
    }),
    db.order.count({ where: { AND: and } }),
  ]);
  return { items, total, page, pageSize: ORDER_PAGE_SIZE };
}

/** Detalhe sem segredos (mpPaymentId e pixQrCode ficam de fora; so o tipo de pagamento derivado). */
export async function getOrderDetail(storeId: string, orderId: string) {
  const o = await dbForStore(storeId).order.findFirst({
    where: { id: orderId },
    select: {
      id: true, status: true, subtotalCents: true, shippingCents: true, totalCents: true, shippingService: true, trackingCode: true,
      addressSnapshot: true, createdAt: true, pixQrCode: true, mpPaymentId: true,
      customer: { select: { id: true, name: true, email: true, phone: true } },
      items: { select: { id: true, productName: true, sku: true, color: true, size: true, unitPriceCents: true, quantity: true }, orderBy: { id: "asc" } },
    },
  });
  if (!o) return null;
  const { pixQrCode, mpPaymentId, ...rest } = o;
  return { ...rest, paymentMethod: pixQrCode ? ("Pix" as const) : mpPaymentId ? ("Cartão" as const) : null };
}

export async function listCustomers(storeId: string, query: { page?: number; q?: string }) {
  const page = query.page ?? 1;
  const q = query.q && literal(query.q);
  const where: Prisma.CustomerWhereInput = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
    : {};
  const db = dbForStore(storeId);
  const [rows, total] = await Promise.all([
    db.customer.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * ORDER_PAGE_SIZE, take: ORDER_PAGE_SIZE, select: { id: true, name: true, email: true, createdAt: true } }),
    db.customer.count({ where }),
  ]);
  const sums = await db.order.groupBy({ by: ["customerId", "status"], where: { customerId: { in: rows.map((r) => r.id) } }, _count: { _all: true }, _sum: { totalCents: true } });
  const items = rows.map((r) => {
    const mine = sums.filter((s) => s.customerId === r.id);
    return {
      ...r,
      orderCount: mine.reduce((n, s) => n + s._count._all, 0),
      // gasto = so pedidos pagos (PAID/SHIPPED/DELIVERED); pendente e cancelado nao contam
      totalSpentCents: mine.filter((s) => PAID_STATUSES.includes(s.status)).reduce((n, s) => n + (s._sum.totalCents ?? 0), 0),
    };
  });
  return { items, total, page, pageSize: ORDER_PAGE_SIZE };
}
