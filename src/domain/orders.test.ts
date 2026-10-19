import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Package, ShippingOption, ShippingProvider } from "@/integrations/shipping/types";
import { ShippingError } from "@/integrations/shipping/types";
import { prisma } from "@/lib/db";
import { StoreSuspendedError } from "./subscription";
import {
  AddressInvalidError, CartChangedError, cancelOrder, createOrder, EmptyCartError, OrderNotFoundError,
  OutOfStockError, OversizeItemError, ShippingOptionInvalidError,
} from "./orders";

let tag: string;
let planId: string;
const stores: string[] = [];

/** PAC 1000 + 100 por pacote; `onQuote` roda antes de responder (barreira/injecao de corrida). */
function fakeProvider(onQuote?: () => Promise<void>): ShippingProvider & { calls: { fromCep: string; toCep: string; packages: Package[] }[] } {
  const calls: { fromCep: string; toCep: string; packages: Package[] }[] = [];
  return {
    calls,
    async quote(input): Promise<ShippingOption[]> {
      calls.push(input);
      await onQuote?.();
      return [{ service: "PAC", priceCents: 1000, days: 6 }, { service: "SEDEX", priceCents: 2500, days: 2 }];
    },
  };
}

/** Libera todos quando `n` chegaram: garante que todos leram o estoque antes de qualquer baixa. */
function barrier(n: number) {
  let release!: () => void;
  const all = new Promise<void>((r) => { release = r; });
  let count = 0;
  return () => { if (++count === n) release(); return all; };
}

async function mkStore(k: string) {
  const s = await prisma.store.create({ data: { slug: `ord-${k}-${tag}`, name: `Loja ${k}`, planId } });
  stores.push(s.id);
  return s.id;
}
async function mkVariant(storeId: string, k: string, o: { price?: number; stock?: number; weight?: number; height?: number } = {}) {
  const p = await prisma.product.create({
    data: { storeId, slug: `p-${k}-${tag}`, name: `Produto ${k}`, weightGrams: o.weight ?? 300, heightCm: o.height ?? 5, widthCm: 20, lengthCm: 30 },
  });
  return (await prisma.variant.create({
    data: { storeId, productId: p.id, sku: `SKU-${k}-${tag}`, color: "Azul", size: "G", priceCents: o.price ?? 5000, stock: o.stock ?? 10 },
  })).id;
}
async function mkCustomer(storeId: string, k: string) {
  const c = await prisma.customer.create({ data: { storeId, name: `Cli ${k}`, email: `${k}-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } });
  const a = await prisma.address.create({
    data: { storeId, customerId: c.id, cep: "01001000", street: "Praça da Sé", number: "100", complement: "ap 1", district: "Sé", city: "São Paulo", state: "SP" },
  });
  return { customerId: c.id, addressId: a.id };
}
const stockOf = async (id: string) => (await prisma.variant.findUniqueOrThrow({ where: { id } })).stock;

let S: string;
let cust: { customerId: string; addressId: string };
beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-Ord" }, update: {},
    create: { name: "Teste-Ord", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  S = await mkStore("s");
  cust = await mkCustomer(S, "c");
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Ord" } });
  await prisma.$disconnect();
});

const order = (lines: { variantId: string; qty: number }[], o: { provider?: ShippingProvider; shippingService?: string; storeId?: string; c?: typeof cust } = {}) =>
  createOrder({ storeId: o.storeId ?? S, ...(o.c ?? cust), lines, shippingService: o.shippingService ?? "SEDEX" }, { provider: o.provider ?? fakeProvider() });

describe("createOrder", () => {
  it("grava snapshots, totais (subtotal + frete da cotacao do servidor), endereco e baixa o estoque", async () => {
    const a = await mkVariant(S, "a", { price: 4990, stock: 5 });
    const b = await mkVariant(S, "b", { price: 1500, stock: 3 });
    const prov = fakeProvider();
    const o = await order([{ variantId: a, qty: 2 }, { variantId: b, qty: 1 }], { provider: prov });
    expect(o).toMatchObject({
      storeId: S, customerId: cust.customerId, status: "PENDING_PAYMENT", subtotalCents: 11480, shippingCents: 2500, totalCents: 13980, shippingService: "SEDEX",
      addressSnapshot: { cep: "01001000", street: "Praça da Sé", number: "100", complement: "ap 1", district: "Sé", city: "São Paulo", state: "SP" },
    });
    expect(o.items.map(({ variantId, productName, sku, color, size, unitPriceCents, quantity }) => ({ variantId, productName, sku, color, size, unitPriceCents, quantity }))
      .sort((x, y) => x.sku.localeCompare(y.sku))).toEqual([
      { variantId: a, productName: "Produto a", sku: `SKU-a-${tag}`, color: "Azul", size: "G", unitPriceCents: 4990, quantity: 2 },
      { variantId: b, productName: "Produto b", sku: `SKU-b-${tag}`, color: "Azul", size: "G", unitPriceCents: 1500, quantity: 1 },
    ]);
    expect(await stockOf(a)).toBe(3);
    expect(await stockOf(b)).toBe(2);
    expect(prov.calls[0]).toMatchObject({ fromCep: "37175000", toCep: "01001000" });
  });

  it("ultima unidade: N pedidos em paralelo -> exatamente 1 pedido, demais OutOfStockError, estoque final 0", async () => {
    const v = await mkVariant(S, "last", { stock: 1 });
    const N = 5;
    const custs = await Promise.all(Array.from({ length: N }, (_, i) => mkCustomer(S, `p${i}`)));
    const gate = barrier(N);
    const res = await Promise.allSettled(custs.map((c) => order([{ variantId: v, qty: 1 }], { c, provider: fakeProvider(gate) })));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const errs = res.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);
    expect(errs).toHaveLength(N - 1);
    for (const e of errs) expect(e).toBeInstanceOf(OutOfStockError);
    expect(await stockOf(v)).toBe(0);
    expect(await prisma.order.count({ where: { storeId: S } })).toBe(1);
  });

  it("falha numa linha desfaz a baixa das linhas anteriores (rollback) e nao cria pedido", async () => {
    const x = await mkVariant(S, "x", { stock: 5 });
    const y = await mkVariant(S, "y", { stock: 5 });
    const [first, last] = [x, y].sort();
    // depois da leitura e antes da baixa, outro processo zera a variacao que sera baixada por ultimo
    const prov = fakeProvider(async () => { await prisma.variant.update({ where: { id: last }, data: { stock: 0 } }); });
    const err = await order([{ variantId: x, qty: 2 }, { variantId: y, qty: 2 }], { provider: prov }).catch((e) => e);
    expect(err).toBeInstanceOf(OutOfStockError);
    expect(err.variantId).toBe(last);
    expect(await stockOf(first)).toBe(5);
    expect(await prisma.order.count({ where: { storeId: S } })).toBe(0);
  });

  it("pedidos concorrentes com as mesmas variacoes em ordem oposta nao entram em deadlock", async () => {
    const a = await mkVariant(S, "da", { stock: 10 });
    const b = await mkVariant(S, "db", { stock: 10 });
    const c2 = await mkCustomer(S, "c2");
    const gate = barrier(2);
    const [o1, o2] = await Promise.all([
      order([{ variantId: a, qty: 1 }, { variantId: b, qty: 1 }], { provider: fakeProvider(gate) }),
      order([{ variantId: b, qty: 2 }, { variantId: a, qty: 2 }], { c: c2, provider: fakeProvider(gate) }),
    ]);
    expect(o1.status).toBe("PENDING_PAYMENT");
    expect(o2.status).toBe("PENDING_PAYMENT");
    expect(await stockOf(a)).toBe(7);
    expect(await stockOf(b)).toBe(7);
  });

  it("loja SUSPENDED -> StoreSuspendedError, estoque intacto", async () => {
    const v = await mkVariant(S, "s", { stock: 2 });
    await prisma.store.update({ where: { id: S }, data: { status: "SUSPENDED" } });
    await expect(order([{ variantId: v, qty: 1 }])).rejects.toBeInstanceOf(StoreSuspendedError);
    expect(await stockOf(v)).toBe(2);
  });

  it("endereco de outro cliente ou de outra loja -> AddressInvalidError", async () => {
    const v = await mkVariant(S, "e", { stock: 2 });
    const other = await mkCustomer(S, "o");
    await expect(order([{ variantId: v, qty: 1 }], { c: { customerId: cust.customerId, addressId: other.addressId } })).rejects.toBeInstanceOf(AddressInvalidError);
    const T = await mkStore("t");
    const foreign = await mkCustomer(T, "f");
    await expect(order([{ variantId: v, qty: 1 }], { c: { customerId: cust.customerId, addressId: foreign.addressId } })).rejects.toBeInstanceOf(AddressInvalidError);
    // cliente de outra loja usando o proprio endereco, mas pedido nesta loja
    await expect(order([{ variantId: v, qty: 1 }], { c: foreign })).rejects.toBeInstanceOf(AddressInvalidError);
    expect(await stockOf(v)).toBe(2);
  });

  it("variacao de outra loja = INACTIVE -> CartChangedError; falta de estoque/quantidade reduzida tambem (nunca ajusta)", async () => {
    const T = await mkStore("t2");
    const foreign = await mkVariant(T, "fv", { stock: 5 });
    const v = await mkVariant(S, "v", { stock: 2 });
    const e1 = await order([{ variantId: v, qty: 1 }, { variantId: foreign, qty: 1 }]).catch((e) => e);
    expect(e1).toBeInstanceOf(CartChangedError);
    expect(e1.issues).toEqual([{ variantId: foreign, kind: "INACTIVE", available: 0 }]);
    const e2 = await order([{ variantId: v, qty: 3 }]).catch((e) => e);
    expect(e2).toBeInstanceOf(CartChangedError);
    expect(e2.issues).toEqual([{ variantId: v, kind: "QTY_REDUCED", available: 2 }]);
    expect(await stockOf(v)).toBe(2);
    expect(await stockOf(foreign)).toBe(5);
  });

  it("carrinho vazio, servico de frete inexistente, item fora dos limites, provedor falhando", async () => {
    const v = await mkVariant(S, "f", { stock: 2 });
    await expect(order([])).rejects.toBeInstanceOf(EmptyCartError);
    await expect(order([{ variantId: v, qty: 1 }], { shippingService: "JADLOG" })).rejects.toBeInstanceOf(ShippingOptionInvalidError);
    const big = await mkVariant(S, "big", { weight: 31000 });
    await expect(order([{ variantId: big, qty: 1 }])).rejects.toBeInstanceOf(OversizeItemError);
    const broken: ShippingProvider = { quote: async () => { throw new Error("rede"); } };
    await expect(order([{ variantId: v, qty: 1 }], { provider: broken })).rejects.toBeInstanceOf(ShippingError);
    expect(await stockOf(v)).toBe(2);
    expect(await prisma.order.count({ where: { storeId: S } })).toBe(0);
  });
});

describe("cancelOrder", () => {
  it("devolve o estoque uma unica vez (idempotente)", async () => {
    const a = await mkVariant(S, "ca", { stock: 4 });
    const o = await order([{ variantId: a, qty: 3 }]);
    expect(await stockOf(a)).toBe(1);
    await cancelOrder(S, o.id);
    await cancelOrder(S, o.id);
    expect(await stockOf(a)).toBe(4);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("CANCELED");
  });

  it("cancelamentos simultaneos devolvem uma vez", async () => {
    const a = await mkVariant(S, "cc", { stock: 4 });
    const o = await order([{ variantId: a, qty: 3 }]);
    await Promise.all([cancelOrder(S, o.id), cancelOrder(S, o.id), cancelOrder(S, o.id)]);
    expect(await stockOf(a)).toBe(4);
  });

  it("pedido em outro status nao muda; pedido inexistente ou de outra loja -> OrderNotFoundError", async () => {
    const a = await mkVariant(S, "cp", { stock: 4 });
    const o = await order([{ variantId: a, qty: 1 }]);
    await prisma.order.update({ where: { id: o.id }, data: { status: "PAID" } });
    await cancelOrder(S, o.id);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PAID");
    expect(await stockOf(a)).toBe(3);
    const T = await mkStore("t3");
    await expect(cancelOrder(T, o.id)).rejects.toBeInstanceOf(OrderNotFoundError);
    await expect(cancelOrder(S, "nao-existe")).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});
