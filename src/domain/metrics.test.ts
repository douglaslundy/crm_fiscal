import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CsvNotAllowedError, computeMetrics, csvCell, exportOrdersCsv, loadStoreMetrics, parseDays, type OrderRow } from "./metrics";

const range = { from: new Date("2026-03-01T03:00:00Z"), to: new Date("2026-03-03T20:00:00Z") }; // 3 dias em Sao Paulo
const row = (status: OrderStatus, totalCents: number, createdAt: string, items: OrderRow["items"] = []): OrderRow => ({ status, totalCents, createdAt: new Date(createdAt), items });

describe("computeMetrics", () => {
  it("so PAID/SHIPPED/DELIVERED contam", () => {
    const m = computeMetrics([
      row("PAID", 1000, "2026-03-01T12:00:00Z"), row("SHIPPED", 2000, "2026-03-02T12:00:00Z"), row("DELIVERED", 3000, "2026-03-02T13:00:00Z"),
      row("CANCELED", 9999, "2026-03-02T12:00:00Z"), row("PENDING_PAYMENT", 9999, "2026-03-02T12:00:00Z"),
    ], range);
    expect(m).toMatchObject({ revenueCents: 6000, orderCount: 3, avgTicketCents: 2000 });
  });
  it("zero pedidos: ticket 0 e todos os dias zerados", () => {
    const m = computeMetrics([], range);
    expect(m).toMatchObject({ revenueCents: 0, orderCount: 0, avgTicketCents: 0, topProducts: [] });
    expect(m.byDay).toEqual([{ date: "2026-03-01", revenueCents: 0 }, { date: "2026-03-02", revenueCents: 0 }, { date: "2026-03-03", revenueCents: 0 }]);
  });
  it("ticket medio e inteiro (floor)", () => {
    expect(computeMetrics([row("PAID", 100, "2026-03-01T12:00:00Z"), row("PAID", 101, "2026-03-01T12:00:00Z")], range).avgTicketCents).toBe(100);
  });
  it("dia em Sao Paulo: 02:59Z ainda e o dia anterior; fora da janela nao conta", () => {
    const m = computeMetrics([row("PAID", 500, "2026-03-02T02:59:00Z"), row("PAID", 700, "2026-03-02T03:00:00Z"), row("PAID", 900, "2026-02-28T12:00:00Z")], range);
    expect(m.byDay).toEqual([{ date: "2026-03-01", revenueCents: 500 }, { date: "2026-03-02", revenueCents: 700 }, { date: "2026-03-03", revenueCents: 0 }]);
    expect(m.orderCount).toBe(2);
  });
  it("topProducts: quantidade desc, empate por nome, maximo 5; cancelados fora", () => {
    const it = (name: string, quantity: number) => ({ name, quantity });
    const m = computeMetrics([
      row("PAID", 1, "2026-03-01T12:00:00Z", [it("B", 2), it("A", 2), it("C", 5), it("D", 1), it("E", 1), it("F", 1)]),
      row("PAID", 1, "2026-03-01T12:00:00Z", [it("D", 1)]),
      row("CANCELED", 1, "2026-03-01T12:00:00Z", [it("Z", 99)]),
    ], range);
    expect(m.topProducts).toEqual([{ name: "C", qty: 5 }, { name: "A", qty: 2 }, { name: "B", qty: 2 }, { name: "D", qty: 2 }, { name: "E", qty: 1 }]);
  });
});

describe("computeMetrics sem advanced", () => {
  it("mantem os 3 totais e nao calcula byDay/topProducts", () => {
    const m = computeMetrics([row("PAID", 1000, "2026-03-01T12:00:00Z", [{ name: "A", quantity: 1 }])], range, false);
    expect(m).toMatchObject({ revenueCents: 1000, orderCount: 1, avgTicketCents: 1000, byDay: [], topProducts: [] });
  });
});

describe("parseDays", () => {
  it("aceita 7/30/90; resto vira 30", () => {
    expect([parseDays("7"), parseDays("90"), parseDays("30")]).toEqual([7, 90, 30]);
    for (const v of [undefined, null, "", "1", "abc", "7.5", "-7", ["7"]]) expect(parseDays(v)).toBe(30);
  });
});

describe("csvCell", () => {
  it("prefixa aspa em formulas e cita especiais", () => {
    for (const f of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(f).replace(/^"|"$/g, "").startsWith("'")).toBe(true);
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("normal")).toBe("normal");
  });
});

describe("loadStoreMetrics / exportOrdersCsv (banco)", () => {
  let tag: string;
  const planIds: string[] = [];
  const stores: string[] = [];
  const mk = async (k: string, adv: boolean, csv: boolean) => {
    const planId = (await prisma.plan.create({ data: { name: `M19-${k}-${tag}`, priceCents: 1, staffLimit: 1, customDomain: false, advancedMetrics: adv, csvExport: csv } })).id;
    planIds.push(planId);
    const s = await prisma.store.create({ data: { slug: `m19-${k}-${tag}`, name: k, planId } });
    stores.push(s.id);
    const c = await prisma.customer.create({ data: { storeId: s.id, name: "=Mal", email: `c-${k}-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } });
    return { id: s.id, customerId: c.id };
  };
  const order = (s: { id: string; customerId: string }, status: OrderStatus, total: number, createdAt: Date) =>
    prisma.order.create({ data: { storeId: s.id, customerId: s.customerId, status, subtotalCents: total, shippingCents: 0, totalCents: total, shippingService: "PAC", addressSnapshot: {}, createdAt, items: { create: { storeId: s.id, productName: "Camiseta", sku: "x", color: "P", size: "M", unitPriceCents: total, quantity: 2 } } } });
  const now = new Date("2026-06-15T15:00:00Z");
  const recent = new Date("2026-06-14T15:00:00Z");

  beforeEach(() => { tag = Math.random().toString(36).slice(2, 8); });
  afterEach(async () => {
    await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
    await prisma.plan.deleteMany({ where: { id: { in: planIds.splice(0) } } });
  });
  afterAll(() => prisma.$disconnect());

  it("Start: so receita/pedidos/ticket; sem byDay nem topProducts", async () => {
    const a = await mk("start", false, false);
    await order(a, "PAID", 1050, recent);
    const m = await loadStoreMetrics(a.id, 7, now);
    expect(m).toEqual({ revenueCents: 1050, orderCount: 1, avgTicketCents: 1050 });
    expect(m).not.toHaveProperty("byDay");
    expect(m).not.toHaveProperty("topProducts");
  });
  it("plano com advancedMetrics recebe byDay (7 dias) e topProducts", async () => {
    const a = await mk("pro", true, false);
    await order(a, "PAID", 1000, recent);
    const m = await loadStoreMetrics(a.id, 7, now);
    expect(m.byDay).toHaveLength(7);
    expect(m.topProducts).toEqual([{ name: "Camiseta", qty: 2 }]);
  });
  it("isolamento: pedidos de outra loja nao entram", async () => {
    const a = await mk("a", true, false);
    const b = await mk("b", true, false);
    await order(a, "PAID", 1000, recent);
    await order(b, "PAID", 5000, recent);
    expect((await loadStoreMetrics(a.id, 30, now)).revenueCents).toBe(1000);
  });
  it("janela: pedido mais velho que o periodo fica fora", async () => {
    const a = await mk("old", false, false);
    await order(a, "PAID", 1000, new Date("2026-05-01T12:00:00Z"));
    expect((await loadStoreMetrics(a.id, 30, now)).orderCount).toBe(0);
    expect((await loadStoreMetrics(a.id, 90, now)).orderCount).toBe(1);
  });
  it("CSV: com teto estourado perde os mais antigos, nunca os recentes; saida cronologica", async () => {
    const a = await mk("cap", true, true);
    await order(a, "PAID", 100, new Date("2026-06-10T12:00:00Z"));
    await order(a, "PAID", 200, new Date("2026-06-12T12:00:00Z"));
    await order(a, "PAID", 300, new Date("2026-06-14T12:00:00Z"));
    const csv = await exportOrdersCsv(a.id, 30, now, 2);
    expect(csv.trim().split(String.fromCharCode(13, 10)).slice(1).map((l) => l.split(",")[5])).toEqual(["2.00", "3.00"]);
  });
  it("CSV: plano sem csvExport lanca CsvNotAllowedError", async () => {
    const a = await mk("nocsv", true, false);
    await expect(exportOrdersCsv(a.id, 30, now)).rejects.toBeInstanceOf(CsvNotAllowedError);
  });
  it("CSV: neutraliza formula no nome do cliente, valor com ponto e so a propria loja", async () => {
    const a = await mk("csv", true, true);
    const b = await mk("csvb", true, true);
    await order(a, "PAID", 1205, recent);
    await order(b, "PAID", 777, recent);
    const csv = await exportOrdersCsv(a.id, 30, now);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("pedido,data,status,cliente,email,total,rastreio");
    expect(lines[1]).toContain(",PAID,'=Mal,");
    expect(lines[1]).toContain(",12.05,");
    expect(csv).not.toContain("7.77");
  });
});
