import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AdminOrderError, getOrderDetail, listCustomers, listOrders, parseListQuery, updateOrder } from "./adminOrders";
import { OrderNotFoundError } from "./orders";

let tag: string;
let planId: string;
const stores: string[] = [];
let S: string;
let cust: string;
let variant: string;

async function mkStore(k: string) {
  const s = await prisma.store.create({ data: { slug: `ao-${k}-${tag}`, name: `Loja ${k}`, planId } });
  stores.push(s.id);
  return s.id;
}
async function mkCustomer(storeId: string, k: string) {
  return (await prisma.customer.create({ data: { storeId, name: `Cli ${k}`, email: `${k}-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } })).id;
}
type Pay = { mpPaymentId?: string | null; pixExpiresAt?: Date | null };
// padrao: Pix ja vencido (nenhum pagamento vivo)
async function mkOrder(storeId: string, customerId: string, status: OrderStatus, o: { total?: number; createdAt?: Date; items?: boolean; pay?: Pay } = {}) {
  const ord = await prisma.order.create({
    data: {
      storeId, customerId, status, subtotalCents: o.total ?? 1000, shippingCents: 0, totalCents: o.total ?? 1000, shippingService: "PAC",
      addressSnapshot: { cep: "01001000", street: "Rua", number: "1", district: "Sé", city: "SP", state: "SP" }, createdAt: o.createdAt,
      mpPaymentId: `mp-${Math.random()}`, pixQrCode: "segredo-pix", pixExpiresAt: new Date(Date.now() - 60_000), ...o.pay,
    },
  });
  if (o.items) await prisma.orderItem.create({ data: { storeId, orderId: ord.id, variantId: variant, productName: "P", sku: "S", color: "Azul", size: "G", unitPriceCents: 1000, quantity: 2 } });
  return ord.id;
}
const statusOf = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-AdminOrd" }, update: {},
    create: { name: "Teste-AdminOrd", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  S = await mkStore("s");
  cust = await mkCustomer(S, "c");
  const p = await prisma.product.create({ data: { storeId: S, slug: `p-${tag}`, name: "P", weightGrams: 1, heightCm: 1, widthCm: 1, lengthCm: 1 } });
  variant = (await prisma.variant.create({ data: { storeId: S, productId: p.id, sku: `S-${tag}`, color: "Azul", size: "G", priceCents: 1000, stock: 5 } })).id;
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-AdminOrd" } });
  await prisma.$disconnect();
});

describe("updateOrder: transicoes", () => {
  it("PAID->SHIPPED com rastreio (trim) e SHIPPED->DELIVERED", async () => {
    const id = await mkOrder(S, cust, "PAID");
    expect(await updateOrder(S, id, { status: "SHIPPED", trackingCode: "  BR123  " })).toMatchObject({ status: "SHIPPED", trackingCode: "BR123" });
    expect(await updateOrder(S, id, { status: "DELIVERED" })).toMatchObject({ status: "DELIVERED", trackingCode: "BR123" });
  });
  it("rastreio editavel em SHIPPED e DELIVERED; vazio limpa", async () => {
    const id = await mkOrder(S, cust, "SHIPPED");
    expect(await updateOrder(S, id, { trackingCode: "X1" })).toMatchObject({ status: "SHIPPED", trackingCode: "X1" });
    await updateOrder(S, id, { status: "DELIVERED" });
    expect(await updateOrder(S, id, { trackingCode: "X2" })).toMatchObject({ status: "DELIVERED", trackingCode: "X2" });
    expect((await updateOrder(S, id, { trackingCode: "" })).trackingCode).toBeNull();
  });
  it.each<[OrderStatus, "SHIPPED" | "DELIVERED"]>([
    ["PENDING_PAYMENT", "SHIPPED"], ["DELIVERED", "SHIPPED"], ["CANCELED", "SHIPPED"], ["PAID", "DELIVERED"], ["PENDING_PAYMENT", "DELIVERED"],
  ])("%s -> %s = 409 INVALID_TRANSITION e nada muda", async (from, to) => {
    const id = await mkOrder(S, cust, from);
    await expect(updateOrder(S, id, { status: to })).rejects.toMatchObject({ code: "INVALID_TRANSITION", status: 409 });
    expect(await statusOf(id)).toBe(from);
  });
  it("rastreio sozinho em PAID/PENDING = 409; rastreio >60 invalido", async () => {
    const id = await mkOrder(S, cust, "PAID");
    await expect(updateOrder(S, id, { trackingCode: "X" })).rejects.toBeInstanceOf(AdminOrderError);
    await expect(updateOrder(S, id, { status: "SHIPPED", trackingCode: "x".repeat(61) })).rejects.toThrow();
    expect(await statusOf(id)).toBe("PAID");
  });
  it("corrida: duas expedicoes simultaneas, so uma vence", async () => {
    const id = await mkOrder(S, cust, "PAID");
    const r = await Promise.allSettled([updateOrder(S, id, { status: "SHIPPED" }), updateOrder(S, id, { status: "SHIPPED" })]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
  });
  it("pedido de outra loja ou inexistente = OrderNotFoundError", async () => {
    const other = await mkStore("o");
    const oc = await mkCustomer(other, "oc");
    const id = await mkOrder(other, oc, "PAID");
    await expect(updateOrder(S, id, { status: "SHIPPED" })).rejects.toBeInstanceOf(OrderNotFoundError);
    await expect(updateOrder(S, "nao-existe", { status: "SHIPPED" })).rejects.toBeInstanceOf(OrderNotFoundError);
    expect(await statusOf(id)).toBe("PAID");
  });
});

describe("updateOrder: cancelamento", () => {
  it("PENDING_PAYMENT cancela e devolve estoque", async () => {
    const id = await mkOrder(S, cust, "PENDING_PAYMENT", { items: true });
    expect((await updateOrder(S, id, { status: "CANCELED" })).status).toBe("CANCELED");
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant } })).stock).toBe(7);
  });
  it.each<OrderStatus>(["PAID", "SHIPPED", "DELIVERED"])("%s = 409 REEMBOLSO_MANUAL, sem mudar status nem estoque", async (st) => {
    const id = await mkOrder(S, cust, st, { items: true });
    await expect(updateOrder(S, id, { status: "CANCELED" })).rejects.toMatchObject({ code: "REEMBOLSO_MANUAL", status: 409 });
    expect(await statusOf(id)).toBe(st);
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant } })).stock).toBe(5);
  });
  it("pagamento ainda vivo (Pix vigente ou cartao pendente sem Pix) = 409 PAGAMENTO_EM_ABERTO, estoque intacto", async () => {
    const pix = await mkOrder(S, cust, "PENDING_PAYMENT", { items: true, pay: { pixExpiresAt: new Date(Date.now() + 10 * 60_000) } });
    await expect(updateOrder(S, pix, { status: "CANCELED" })).rejects.toMatchObject({ code: "PAGAMENTO_EM_ABERTO", status: 409, message: expect.stringMatching(/aguarde/i) });
    const card = await mkOrder(S, cust, "PENDING_PAYMENT", { items: true, pay: { pixExpiresAt: null } });
    await expect(updateOrder(S, card, { status: "CANCELED" })).rejects.toMatchObject({ code: "PAGAMENTO_EM_ABERTO" });
    expect([await statusOf(pix), await statusOf(card)]).toEqual(["PENDING_PAYMENT", "PENDING_PAYMENT"]);
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant } })).stock).toBe(5);
    const none = await mkOrder(S, cust, "PENDING_PAYMENT", { pay: { mpPaymentId: null, pixExpiresAt: null } }); // sem pagamento nenhum
    expect((await updateOrder(S, none, { status: "CANCELED" })).status).toBe("CANCELED");
  });
  it("ja cancelado = 409 INVALID_TRANSITION", async () => {
    const id = await mkOrder(S, cust, "CANCELED");
    await expect(updateOrder(S, id, { status: "CANCELED" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("listas", () => {
  it("filtros status/data/busca, mais novo primeiro, paginacao de 20 e isolamento por loja", async () => {
    const other = await mkStore("o");
    const oc = await mkCustomer(other, "oc");
    await mkOrder(other, oc, "PAID");
    const cust2 = await mkCustomer(S, "maria");
    const old = await mkOrder(S, cust, "PAID", { createdAt: new Date("2026-01-10T15:00:00Z") });
    const mid = await mkOrder(S, cust2, "SHIPPED", { createdAt: new Date("2026-02-10T15:00:00Z") });
    const nw = await mkOrder(S, cust, "PENDING_PAYMENT", { createdAt: new Date("2026-03-10T15:00:00Z") });
    const ids = async (q: Parameters<typeof listOrders>[1]) => (await listOrders(S, q)).items.map((i) => i.id);
    expect(await ids({})).toEqual([nw, mid, old]);
    expect(await ids({ status: "SHIPPED" })).toEqual([mid]);
    expect(await ids({ from: "2026-02-01", to: "2026-02-28" })).toEqual([mid]);
    expect(await ids({ to: "2026-01-10" })).toEqual([old]); // dia final inclusivo
    expect(await ids({ q: "MARIA" })).toEqual([mid]);
    expect(await ids({ q: `c-${tag}@t.local` })).toEqual([nw, old]);
    expect(await ids({ q: nw.slice(0, 10) })).toEqual([nw]);
    for (const q of ["%", "_", "\\"]) expect(await ids({ q }), q).toEqual([]); // curinga do LIKE e literal
    for (let i = 0; i < 20; i++) await mkOrder(S, cust, "PAID", { createdAt: new Date("2026-04-01T12:00:00Z") });
    const p2 = await listOrders(S, { page: 2 });
    expect(p2).toMatchObject({ total: 23, pageSize: 20 });
    expect(p2.items).toHaveLength(3);
    expect(parseListQuery({ page: "99999" })).toBeNull();
    expect(parseListQuery({ from: "x" })).toBeNull();
    for (const d of ["2026-02-31", "2026-02-29", "2026-13-01", "2026-00-10"]) expect(parseListQuery({ from: d }), d).toBeNull();
    expect(parseListQuery({ from: "2028-02-29" })).toEqual({ from: "2028-02-29" });
    expect(parseListQuery({ status: "PAID", q: " ana " })).toEqual({ status: "PAID", q: "ana" });
  });
  it("detalhe nao expoe segredos de pagamento", async () => {
    const id = await mkOrder(S, cust, "PAID", { items: true });
    const d = await getOrderDetail(S, id);
    expect(d).toMatchObject({ paymentMethod: "Pix", items: [{ quantity: 2 }] });
    expect(JSON.stringify(d)).not.toMatch(/segredo-pix|mp-/);
    expect(d).not.toHaveProperty("mpPaymentId");
    const other = await mkStore("o");
    expect(await getOrderDetail(other, id)).toBeNull();
  });
  it("clientes: total gasto soma so PAID/SHIPPED/DELIVERED; busca; isolamento", async () => {
    const c2 = await mkCustomer(S, "zed");
    await mkOrder(S, cust, "PAID", { total: 1000 });
    await mkOrder(S, cust, "DELIVERED", { total: 2500 });
    await mkOrder(S, cust, "PENDING_PAYMENT", { total: 9999 });
    await mkOrder(S, cust, "CANCELED", { total: 7777 });
    const other = await mkStore("o");
    await mkOrder(other, await mkCustomer(other, "oc"), "PAID", { total: 5 });
    const all = await listCustomers(S, {});
    expect(all.total).toBe(2);
    expect(all.items.find((i) => i.id === cust)).toMatchObject({ orderCount: 4, totalSpentCents: 3500 });
    expect(all.items.find((i) => i.id === c2)).toMatchObject({ orderCount: 0, totalSpentCents: 0 });
    expect((await listCustomers(S, { q: "ZED" })).items.map((i) => i.id)).toEqual([c2]);
    expect((await listCustomers(S, { q: "oc-" })).items).toEqual([]);
    expect((await listCustomers(S, { q: "%" })).items).toEqual([]);
    expect((await listCustomers(S, { q: "_" })).items).toEqual([]);
  });
});
