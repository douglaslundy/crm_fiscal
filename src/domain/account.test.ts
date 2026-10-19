import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { deleteAddress, getOrder, listAddresses, listOrders, updateAddress } from "./account";

let tag: string;
const stores: string[] = [];
let A: string;
let B: string;
let c1: string; // loja A
let c2: string; // loja A
let c3: string; // loja B
let orderC1: string;

const mkCustomer = async (storeId: string, k: string) =>
  (await prisma.customer.create({ data: { storeId, name: k, email: `${k}-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } })).id;
const mkAddr = (storeId: string, customerId: string) =>
  prisma.address.create({ data: { storeId, customerId, cep: "01001000", street: "Rua", number: "1", district: "Centro", city: "SP", state: "SP" } });
const input = { cep: "02002000", street: "Nova", number: "9", complement: null, district: "Bairro", city: "RJ", state: "RJ" };

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  const planId = (await prisma.plan.upsert({
    where: { name: "Teste-Acc" }, update: {},
    create: { name: "Teste-Acc", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  A = (await prisma.store.create({ data: { slug: `acc-a-${tag}`, name: "A", planId } })).id;
  B = (await prisma.store.create({ data: { slug: `acc-b-${tag}`, name: "B", planId } })).id;
  stores.push(A, B);
  [c1, c2] = [await mkCustomer(A, "c1"), await mkCustomer(A, "c2")];
  c3 = await mkCustomer(B, "c3");
  const o = await prisma.order.create({
    data: { storeId: A, customerId: c1, subtotalCents: 100, shippingCents: 10, totalCents: 110, shippingService: "PAC", trackingCode: "BR123", addressSnapshot: {} },
  });
  orderC1 = o.id;
  await prisma.orderItem.create({ data: { storeId: A, orderId: o.id, productName: "Camiseta", sku: "s", color: "Preto", size: "M", unitPriceCents: 100, quantity: 1 } });
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Acc" } });
  await prisma.$disconnect();
});

describe("pedidos da conta", () => {
  it("lista e detalha so os do proprio cliente, com itens e rastreio", async () => {
    expect((await listOrders(A, c1)).map((o) => o.id)).toEqual([orderC1]);
    expect(await listOrders(A, c2)).toEqual([]);
    expect(await getOrder(A, c1, orderC1)).toMatchObject({ id: orderC1, trackingCode: "BR123", items: [{ productName: "Camiseta", quantity: 1 }] });
  });
  it("pedido de outro cliente da mesma loja ou consultado por outra loja = null (404)", async () => {
    expect(await getOrder(A, c2, orderC1)).toBeNull();
    expect(await getOrder(B, c3, orderC1)).toBeNull();
    expect(await getOrder(B, c1, orderC1)).toBeNull();
    expect(await listOrders(B, c1)).toEqual([]);
  });
});

describe("enderecos da conta", () => {
  it("edita e apaga o proprio; lista so os dele", async () => {
    const a = await mkAddr(A, c1);
    expect(await updateAddress(A, c1, a.id, input)).toMatchObject({ id: a.id, street: "Nova", state: "RJ" });
    expect(await listAddresses(A, c2)).toEqual([]);
    expect(await deleteAddress(A, c1, a.id)).toBe(true);
    expect(await listAddresses(A, c1)).toEqual([]);
  });
  it("endereco de outro cliente ou de outra loja: nao edita nem apaga (404)", async () => {
    const a = await mkAddr(A, c1);
    expect(await updateAddress(A, c2, a.id, input)).toBeNull();
    expect(await updateAddress(B, c1, a.id, input)).toBeNull();
    expect(await deleteAddress(A, c2, a.id)).toBe(false);
    expect(await deleteAddress(B, c3, a.id)).toBe(false);
    expect(await prisma.address.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ street: "Rua" });
  });
  it("apagar endereco nao toca pedidos (guardam snapshot)", async () => {
    const a = await mkAddr(A, c1);
    expect(await deleteAddress(A, c1, a.id)).toBe(true);
    expect(await prisma.order.count({ where: { id: orderC1 } })).toBe(1);
  });
});
