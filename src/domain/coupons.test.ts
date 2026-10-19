import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShippingProvider } from "@/integrations/shipping/types";
import { prisma } from "@/lib/db";
import { CouponBody, CouponError, CouponPatch, createCoupon, deleteCoupon, discountFor, listCoupons, updateCoupon, type CouponInput } from "./coupons";
import { cancelOrder, createOrder } from "./orders";

let tag: string;
let planId: string;
const stores: string[] = [];
const provider: ShippingProvider = { quote: async () => [{ service: "PAC", priceCents: 1000, days: 6 }] };

const mkStore = async (k: string) => {
  const s = await prisma.store.create({ data: { slug: `cup-${k}-${tag}`, name: `Loja ${k}`, planId } });
  stores.push(s.id);
  return s.id;
};
async function mkVariant(storeId: string, price = 5000) {
  const p = await prisma.product.create({ data: { storeId, slug: `p-${Math.random().toString(36).slice(2, 7)}`, name: "Prod", weightGrams: 300, heightCm: 5, widthCm: 20, lengthCm: 30 } });
  return (await prisma.variant.create({ data: { storeId, productId: p.id, sku: `S-${Math.random().toString(36).slice(2, 8)}`, color: "Azul", size: "G", priceCents: price, stock: 10 } })).id;
}
async function mkCustomer(storeId: string, k: string) {
  const c = await prisma.customer.create({ data: { storeId, name: k, email: `${k}-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } });
  const a = await prisma.address.create({ data: { storeId, customerId: c.id, cep: "01001000", street: "Praça", number: "1", district: "Sé", city: "SP", state: "SP" } });
  return { customerId: c.id, addressId: a.id };
}
const base = (o: Partial<CouponInput> = {}): CouponInput => ({ code: "PROMO10", kind: "PERCENT", value: 10, minSubtotalCents: 0, maxUses: null, startsAt: null, expiresAt: null, active: true, ...o });
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof CouponError ? e.code : String(e)));

let S: string;
let v: string;
let cust: Awaited<ReturnType<typeof mkCustomer>>;
const buy = (couponCode?: string, c = cust, storeId = S, variantId = v, expectedTotalCents?: number) =>
  createOrder({ storeId, ...c, lines: [{ variantId, qty: 2 }], shippingService: "PAC", couponCode, expectedTotalCents }, { provider });
const couponRow = (storeId: string, c = "PROMO10") => prisma.coupon.findFirstOrThrow({ where: { storeId, code: c } });

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-Cup" }, update: {},
    create: { name: "Teste-Cup", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  S = await mkStore("s");
  v = await mkVariant(S); // 2 x 5000 = 10000 de subtotal
  cust = await mkCustomer(S, "c");
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Cup" } });
  await prisma.$disconnect();
});

describe("discountFor", () => {
  it("percentual arredonda para baixo; fixo nunca passa do subtotal; 100% zera o subtotal", () => {
    expect(discountFor({ kind: "PERCENT", value: 10 }, 9999)).toBe(999);
    expect(discountFor({ kind: "FIXED", value: 5000 }, 3000)).toBe(3000);
    expect(discountFor({ kind: "PERCENT", value: 100 }, 1234)).toBe(1234);
    expect(discountFor({ kind: "FIXED", value: 500 }, 0)).toBe(0);
  });
});

describe("cupom no pedido", () => {
  it("desconta so dos itens, grava snapshot, consome um uso e confere o total esperado", async () => {
    await createCoupon(S, base());
    const o = await buy("  promo10 ", cust, S, v, 10000 - 1000 + 1000);
    expect(o).toMatchObject({ subtotalCents: 10000, discountCents: 1000, shippingCents: 1000, totalCents: 10000, couponCode: "PROMO10" });
    expect((await couponRow(S)).usedCount).toBe(1);
    expect(o.couponId).toBe((await couponRow(S)).id);
  });
  it("cliente usa o cupom uma vez; cancelar o pedido devolve o uso e libera o cliente", async () => {
    await createCoupon(S, base());
    const o = await buy("PROMO10");
    expect(await code(buy("PROMO10"))).toBe("COUPON_ALREADY_USED");
    expect(await cancelOrder(S, o.id)).toBe(true);
    expect((await couponRow(S)).usedCount).toBe(0);
    expect(await code(buy("PROMO10"))).toBe("ok");
    expect((await couponRow(S)).usedCount).toBe(1);
  });
  it("cancelar duas vezes nao devolve o uso duas vezes", async () => {
    await createCoupon(S, base());
    const o = await buy("PROMO10");
    const other = await mkCustomer(S, "d");
    await buy("PROMO10", other);
    await cancelOrder(S, o.id);
    await cancelOrder(S, o.id);
    expect((await couponRow(S)).usedCount).toBe(1);
  });
  it("mesmo cliente, pedidos simultaneos (chaves diferentes): so um leva o cupom", async () => {
    await createCoupon(S, base());
    const results = await Promise.all([1, 2, 3, 4].map(() => code(buy("PROMO10"))));
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect((await couponRow(S)).usedCount).toBe(1);
    expect(await prisma.order.count({ where: { storeId: S, couponCode: "PROMO10" } })).toBe(1);
  });
  it("limite de usos: concorrencia com 1 uso restante, so um pedido passa", async () => {
    await createCoupon(S, base({ maxUses: 1 }));
    const customers = await Promise.all(["x1", "x2", "x3"].map((k) => mkCustomer(S, k)));
    const results = await Promise.all(customers.map((c) => code(buy("PROMO10", c))));
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "COUPON_EXHAUSTED")).toHaveLength(2);
    expect((await couponRow(S)).usedCount).toBe(1);
  });
  it("invalido: inexistente, inativo, vencido, ainda nao iniciado, de outra loja, formato ruim", async () => {
    const now = Date.now();
    await createCoupon(S, base({ code: "OFF", active: false }));
    await createCoupon(S, base({ code: "VELHO", expiresAt: new Date(now - 1000) }));
    await createCoupon(S, base({ code: "FUTURO", startsAt: new Date(now + 86_400_000) }));
    const other = await mkStore("o");
    await createCoupon(other, base({ code: "ALHEIO" }));
    for (const c of ["NAOEXISTE", "OFF", "VELHO", "FUTURO", "ALHEIO", "x", "a b c"]) expect(await code(buy(c)), c).toBe("COUPON_INVALID");
    expect(await prisma.order.count({ where: { storeId: S } })).toBe(0);
  });
  it("subtotal minimo; falha do cupom nao baixa estoque", async () => {
    await createCoupon(S, base({ minSubtotalCents: 10001 }));
    expect(await code(buy("PROMO10"))).toBe("COUPON_MIN_SUBTOTAL");
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: v } })).stock).toBe(10);
  });
  it("cupom que zera os itens: total = so o frete", async () => {
    await createCoupon(S, base({ kind: "FIXED", value: 99999 }));
    expect(await buy("PROMO10")).toMatchObject({ discountCents: 10000, totalCents: 1000 });
  });
  it("total esperado sem considerar o desconto -> TotalChangedError", async () => {
    await createCoupon(S, base());
    await expect(buy("PROMO10", cust, S, v, 11000)).rejects.toMatchObject({ totalCents: 10000 });
  });
});

describe("CRUD e validacao", () => {
  it("codigo repetido na loja 409; mesmo codigo em outra loja pode; lista, edita e exclui", async () => {
    await createCoupon(S, base());
    expect(await code(createCoupon(S, base()))).toBe("COUPON_CODE_TAKEN");
    const other = await mkStore("o2");
    expect(await code(createCoupon(other, base()))).toBe("ok");
    const [c] = await listCoupons(S);
    expect((await updateCoupon(S, c.id, { value: 20, active: false })).value).toBe(20);
    expect(await code(updateCoupon(S, c.id, { value: 150 }))).toBe("COUPON_INVALID"); // percentual > 100
    expect(await code(updateCoupon(other, c.id, { value: 5 }))).toBe("COUPON_NOT_FOUND");
    expect(await code(deleteCoupon(other, c.id))).toBe("COUPON_NOT_FOUND");
    expect(await code(deleteCoupon(S, c.id))).toBe("ok");
    expect(await listCoupons(S)).toEqual([]);
  });
  it("excluir cupom nao afeta pedido ja feito", async () => {
    await createCoupon(S, base());
    const o = await buy("PROMO10");
    await deleteCoupon(S, (await couponRow(S)).id);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ couponCode: "PROMO10", discountCents: 1000 });
    expect(await cancelOrder(S, o.id)).toBe(true); // release de cupom inexistente nao quebra
  });
  it("schema: codigo normalizado, percentual 1-100, janela coerente, datas AAAA-MM-DD em Brasilia", () => {
    const ok = CouponBody.parse({ code: " verao-25 ", kind: "PERCENT", value: 25, startsAt: "2026-12-01", expiresAt: "2026-12-31" });
    expect(ok.code).toBe("VERAO-25");
    expect(ok.startsAt?.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(ok.expiresAt?.toISOString()).toBe("2027-01-01T03:00:00.000Z"); // 31/12 inteiro vale
    expect(CouponBody.parse({ code: "ABC", kind: "FIXED", value: 100, startsAt: "", expiresAt: "" })).toMatchObject({ startsAt: null, expiresAt: null });
    for (const bad of [{ value: 101 }, { value: 0 }, { code: "ab" }, { code: "com espaco" }, { startsAt: "2026-12-31", expiresAt: "2026-12-01" }]) {
      expect(CouponBody.safeParse({ code: "ABC", kind: "PERCENT", value: 10, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(CouponPatch.parse({ expiresAt: "" })).toEqual({ expiresAt: null });
  });
});
