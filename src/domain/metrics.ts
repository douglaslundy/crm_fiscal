import type { OrderStatus } from "@prisma/client";
import { dbForStore } from "@/lib/db-store";
import { getFeatures } from "./entitlements";

export type OrderRow = { status: OrderStatus; totalCents: number; createdAt: Date; items: { name: string; quantity: number }[] };
export type Metrics = {
  revenueCents: number;
  orderCount: number;
  avgTicketCents: number;
  topProducts: { name: string; qty: number }[];
  byDay: { date: string; revenueCents: number }[];
};

const COUNTED: OrderStatus[] = ["PAID", "SHIPPED", "DELIVERED"];
const DAY = 86400_000;
// shortcut: Sao Paulo fixo em UTC-3 (sem horario de verao desde 2019), reavaliar se o Brasil voltar ao DST.
const spDay = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
export const DAYS_OPTIONS = [7, 30, 90] as const;
export const MAX_ROWS = 20000; // shortcut: teto de linhas do CSV, mais recentes primeiro (os mais antigos sao omitidos); trocar por streaming se alguma loja passar disso.

/** Qualquer valor fora de 7/30/90 vira 30. */
export const parseDays = (v: unknown): number => {
  const n = Number(Array.isArray(v) ? undefined : v);
  return (DAYS_OPTIONS as readonly number[]).includes(n) ? n : 30;
};

export const rangeForDays = (days: number, now = new Date()) => ({ from: new Date(now.getTime() - (days - 1) * DAY - ((now.getTime() - 3 * 3600_000) % DAY)), to: now });

/** Acumula pedidos aos poucos (lotes do banco). So PAID|SHIPPED|DELIVERED dentro de [from, to]; byDay traz todos os dias (fuso de Sao Paulo), zerados quando sem venda. */
export function createAccumulator(range: { from: Date; to: Date }, advanced = true) {
  const byDay = new Map<string, number>();
  for (let t = range.from.getTime(); advanced && spDay(new Date(t)) <= spDay(range.to); t += DAY) byDay.set(spDay(new Date(t)), 0);
  const qty = new Map<string, number>();
  let revenueCents = 0;
  let orderCount = 0;
  return {
    add(o: OrderRow) {
      if (!COUNTED.includes(o.status) || o.createdAt < range.from || o.createdAt > range.to) return;
      revenueCents += o.totalCents;
      orderCount++;
      if (!advanced) return;
      byDay.set(spDay(o.createdAt), (byDay.get(spDay(o.createdAt)) ?? 0) + o.totalCents);
      for (const i of o.items) qty.set(i.name, (qty.get(i.name) ?? 0) + i.quantity);
    },
    result(): Metrics {
      return {
        revenueCents,
        orderCount,
        avgTicketCents: orderCount === 0 ? 0 : Math.floor(revenueCents / orderCount),
        topProducts: [...qty].map(([name, q]) => ({ name, qty: q })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)).slice(0, 5),
        byDay: [...byDay].map(([date, revenueCents]) => ({ date, revenueCents })),
      };
    },
  };
}

/** Puro; versao de uma passada de createAccumulator. */
export function computeMetrics(orders: OrderRow[], range: { from: Date; to: Date }, advanced = true): Metrics {
  const acc = createAccumulator(range, advanced);
  for (const o of orders) acc.add(o);
  return acc.result();
}

export type StoreMetrics = Pick<Metrics, "revenueCents" | "orderCount" | "avgTicketCents"> & Partial<Pick<Metrics, "topProducts" | "byDay">>;

const BATCH = 2000;

/** Dados da pagina: byDay/topProducts so existem no resultado se o plano tem advancedMetrics (nem sao enviados ao Start). Le todo o periodo em lotes por id (sem teto de pedidos). */
export async function loadStoreMetrics(storeId: string, days: number, now = new Date(), batch = BATCH): Promise<StoreMetrics> {
  const advanced = (await getFeatures(storeId)).advancedMetrics;
  const range = rangeForDays(days, now);
  const db = dbForStore(storeId);
  const acc = createAccumulator(range, advanced);
  for (let after: string | undefined; ; ) {
    const rows = await db.order.findMany({
      where: { status: { in: COUNTED }, createdAt: { gte: range.from, lte: range.to }, ...(after ? { id: { gt: after } } : {}) },
      // Start nao le os itens: byDay/topProducts nem sao calculados.
      select: { id: true, status: true, totalCents: true, createdAt: true, ...(advanced ? { items: { select: { productName: true, quantity: true } } } : {}) },
      orderBy: { id: "asc" },
      take: batch,
    });
    for (const r of rows) acc.add({ ...r, items: "items" in r ? r.items.map((i) => ({ name: i.productName, quantity: i.quantity })) : [] });
    if (rows.length < batch) break;
    after = rows[rows.length - 1].id;
  }
  const m = acc.result();
  const { revenueCents, orderCount, avgTicketCents } = m;
  return advanced ? m : { revenueCents, orderCount, avgTicketCents };
}

/** Neutraliza formula (=,+,-,@,tab,CR) e cita campos com virgula, aspas ou quebra de linha. */
export function csvCell(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export class CsvNotAllowedError extends Error {
  name = "CsvNotAllowedError";
}

export async function exportOrdersCsv(storeId: string, days: number, now = new Date(), cap = MAX_ROWS): Promise<string> {
  if (!(await getFeatures(storeId)).csvExport) throw new CsvNotAllowedError();
  const range = rangeForDays(days, now);
  const rows = await dbForStore(storeId).order.findMany({
    where: { createdAt: { gte: range.from, lte: range.to } },
    select: { id: true, createdAt: true, status: true, totalCents: true, trackingCode: true, customer: { select: { name: true, email: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: cap,
  });
  rows.reverse(); // cronologico na saida; o corte do teto descarta os mais antigos, nunca os recentes
  const lines = rows.map((o) =>
    [o.id, o.createdAt.toISOString(), o.status, o.customer.name, o.customer.email, `${Math.floor(o.totalCents / 100)}.${String(o.totalCents % 100).padStart(2, "0")}`, o.trackingCode ?? ""].map(csvCell).join(","),
  );
  return ["pedido,data,status,cliente,email,total,rastreio", ...lines].join("\r\n") + "\r\n";
}
