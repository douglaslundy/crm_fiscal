import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGateway } from "@/integrations/payments";
import type { PaymentGateway } from "@/integrations/payments/types";
import { prisma } from "@/lib/db";
import { cancelOrder } from "./orders";
import { amountFor, applyPaymentUpdate, expireOrders, PayError, payOrder, syncPayment } from "./payments";
import { updateSettings } from "./storeSettings";

const fake = fakeGateway();
let tag: string;
let planId: string;
const stores: string[] = [];
let S: string;
let cust: string;

async function mkStore(k: string) {
  const s = await prisma.store.create({ data: { slug: `pay-${k}-${tag}`, name: `Loja ${k}`, planId } });
  stores.push(s.id);
  return s.id;
}
async function mkCustomer(storeId: string, k: string) {
  return (await prisma.customer.create({ data: { storeId, name: k, email: `${k}-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } })).id;
}
/** Pedido PENDING_PAYMENT com 1 item de `qty` unidades ja baixadas do estoque (variante fica com 10 - qty). */
async function mkOrder(storeId: string, customerId: string, o: { totalCents?: number; qty?: number; createdAt?: Date; pixExpiresAt?: Date; mpPaymentId?: string } = {}) {
  const k = Math.random().toString(36).slice(2, 8);
  const qty = o.qty ?? 2;
  const p = await prisma.product.create({ data: { storeId, slug: `p-${k}-${tag}`, name: "Prod", weightGrams: 300, heightCm: 5, widthCm: 20, lengthCm: 30 } });
  const v = await prisma.variant.create({ data: { storeId, productId: p.id, sku: `S-${k}-${tag}`, color: "Azul", size: "G", priceCents: 1000, stock: 10 - qty } });
  const total = o.totalCents ?? 10001;
  const order = await prisma.order.create({
    data: {
      storeId, customerId, subtotalCents: total - 1000, shippingCents: 1000, totalCents: total, shippingService: "PAC", addressSnapshot: {},
      createdAt: o.createdAt, pixExpiresAt: o.pixExpiresAt, pixQrCode: o.pixExpiresAt ? "qr" : undefined, mpPaymentId: o.mpPaymentId,
    },
  });
  await prisma.orderItem.create({ data: { storeId, orderId: order.id, variantId: v.id, productName: "Prod", sku: "S", color: "Azul", size: "G", unitPriceCents: 1000, quantity: qty } });
  return { id: order.id, variantId: v.id };
}
const order = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
const stock = async (id: string) => (await prisma.variant.findUniqueOrThrow({ where: { id } })).stock;
const card = (token: string) => ({ token, installments: 1, paymentMethodId: "visa" });
const remote = (id: string, orderId: string, status: "approved" | "rejected" | "cancelled" | "pending" | "refunded", amountCents = 10001, paymentTypeId = "credit_card") =>
  fake.put({ id, status, externalReference: orderId, amountCents, paymentTypeId });
const alerts = () => vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-Pay" }, update: {},
    create: { name: "Teste-Pay", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  S = await mkStore("s");
  cust = await mkCustomer(S, "c");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Pay" } });
  await prisma.$disconnect();
});

describe("amountFor", () => {
  it("Pix: centavo para baixo (10001 com 5% -> 9500); cartao = total", () => {
    expect(amountFor("pix", 10001, 5)).toBe(9500);
    expect(amountFor("pix", 999, 10)).toBe(899);
    expect(amountFor("pix", 10001, 0)).toBe(10001);
    expect(amountFor("card", 10001, 5)).toBe(10001);
  });
});

describe("payOrder", () => {
  it("cartao aprovado -> PAID com o pagamento registrado; valor = total do pedido", async () => {
    const o = await mkOrder(S, cust);
    expect(await payOrder({ storeId: S, customerId: cust, orderId: o.id, method: "card", card: card("approved") }, fake)).toEqual({ status: "PAID" });
    const db = await order(o.id);
    expect(db.status).toBe("PAID");
    expect(fake.payments.get(db.mpPaymentId!)).toMatchObject({ amountCents: 10001, externalReference: o.id });
  });

  it("cartao recusado -> REJECTED, pedido segue aguardando e o id recusado nao vira o pagamento atual; outro cartao paga", async () => {
    const o = await mkOrder(S, cust);
    await expect(payOrder({ storeId: S, customerId: cust, orderId: o.id, method: "card", card: card("rejected") }, fake))
      .rejects.toMatchObject({ code: "REJECTED" });
    expect(await order(o.id)).toMatchObject({ status: "PENDING_PAYMENT", mpPaymentId: null });
    const rejectedId = [...fake.payments.values()].find((p) => p.externalReference === o.id)!.id;
    expect(await syncPayment(S, rejectedId, fake)).toBe("noop"); // webhook do recusado: ignorado
    expect((await order(o.id)).status).toBe("PENDING_PAYMENT");
    expect((await payOrder({ storeId: S, customerId: cust, orderId: o.id, method: "card", card: card("approved") }, fake)).status).toBe("PAID");
  });

  it("cartao pendente -> aguarda; webhook rejected do pagamento atual -> CANCELED e estoque devolvido", async () => {
    const o = await mkOrder(S, cust);
    expect((await payOrder({ storeId: S, customerId: cust, orderId: o.id, method: "card", card: card("pending") }, fake)).status).toBe("PENDING_PAYMENT");
    const { mpPaymentId } = await order(o.id);
    expect(mpPaymentId).toBeTruthy();
    remote(mpPaymentId!, o.id, "rejected");
    expect(await syncPayment(S, mpPaymentId!, fake)).toBe("canceled");
    expect((await order(o.id)).status).toBe("CANCELED");
    expect(await stock(o.variantId)).toBe(10);
    expect(await syncPayment(S, mpPaymentId!, fake)).toBe("noop"); // repetido: estoque nao volta de novo
    expect(await stock(o.variantId)).toBe(10);
  });

  it("Pix: valor com desconto (piso), QR e expiracao de 30 min gravados; 2a chamada reaproveita; vencido -> PIX_EXPIRED", async () => {
    await updateSettings(S, { pixDiscountPercent: 5 });
    const o = await mkOrder(S, cust, { totalCents: 10001 });
    const t0 = Date.now();
    const r = await payOrder({ storeId: S, customerId: cust, orderId: o.id, method: "pix" }, fake);
    expect(r.pix!.amountCents).toBe(9500);
    const db = await order(o.id);
    expect(fake.payments.get(db.mpPaymentId!)!.amountCents).toBe(9500);
    expect(db.pixQrCode).toBe(r.pix!.qrCode);
    expect(db.pixExpiresAt!.getTime() - t0).toBeGreaterThan(29 * 60_000);
    expect(db.pixExpiresAt!.getTime() - t0).toBeLessThanOrEqual(30 * 60_000 + 1000);
    const size = fake.payments.size;
    const again = await payOrder({ storeId: S, customerId: cust, orderId: o.id, method: "pix" }, fake);
    expect(again.pix!.qrCode).toBe(r.pix!.qrCode);
    expect(fake.payments.size).toBe(size);
    await expect(payOrder({ storeId: S, customerId: cust, orderId: o.id, method: "pix" }, fake, new Date(t0 + 31 * 60_000)))
      .rejects.toMatchObject({ code: "PIX_EXPIRED" });
  });

  it("Pix vigente -> cartao recusado com PIX_LIVE sem cobrar nem trocar o pagamento atual; cron concilia o Pix", async () => {
    const o = await mkOrder(S, cust);
    await payOrder({ storeId: S, customerId: cust, orderId: o.id, method: "pix" }, fake);
    const { mpPaymentId: pixId } = await order(o.id);
    const size = fake.payments.size;
    for (const t of ["pending", "approved"]) {
      await expect(payOrder({ storeId: S, customerId: cust, orderId: o.id, method: "card", card: card(t) }, fake)).rejects.toMatchObject({ code: "PIX_LIVE" });
    }
    expect(fake.payments.size).toBe(size);
    expect(await order(o.id)).toMatchObject({ status: "PENDING_PAYMENT", mpPaymentId: pixId });
    remote(pixId!, o.id, "approved", 10001, "bank_transfer");
    await expireOrders(new Date(Date.now() + 31 * 60_000));
    expect((await order(o.id)).status).toBe("PAID");
  });

  it("mesmo cartao enviado duas vezes ao mesmo tempo -> as duas respostas PAID (paid + noop)", async () => {
    const o = await mkOrder(S, cust);
    // as duas leem o pedido PENDING antes de qualquer cobranca (barreira no payCard)
    let release!: () => void;
    const both = new Promise<void>((r) => { release = r; });
    let n = 0;
    const gw: PaymentGateway = {
      payPix: fake.payPix.bind(fake), getPayment: fake.getPayment.bind(fake),
      payCard: async (input, key) => { if (++n === 2) release(); await both; return fake.payCard(input, key); },
    };
    const pay2 = () => payOrder({ storeId: S, customerId: cust, orderId: o.id, method: "card", card: card("approved") }, gw);
    expect(await Promise.all([pay2(), pay2()])).toEqual([{ status: "PAID" }, { status: "PAID" }]);
  });

  it("pedido de outro cliente ou de outra loja -> NOT_FOUND; pedido pago -> NOT_PENDING", async () => {
    const other = await mkCustomer(S, "o");
    const o = await mkOrder(S, other);
    await expect(payOrder({ storeId: S, customerId: cust, orderId: o.id, method: "pix" }, fake)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const T = await mkStore("t");
    const tc = await mkCustomer(T, "t");
    const ot = await mkOrder(T, tc);
    await expect(payOrder({ storeId: S, customerId: cust, orderId: ot.id, method: "pix" }, fake)).rejects.toBeInstanceOf(PayError);
    const mine = await mkOrder(S, cust);
    await prisma.order.update({ where: { id: mine.id }, data: { status: "PAID" } });
    await expect(payOrder({ storeId: S, customerId: cust, orderId: mine.id, method: "card", card: card("approved") }, fake))
      .rejects.toMatchObject({ code: "NOT_PENDING" });
    expect(await order(ot.id)).toMatchObject({ status: "PENDING_PAYMENT", mpPaymentId: null });
  });
});

describe("applyPaymentUpdate / syncPayment", () => {
  it("approved repetido -> uma transicao so (paid, depois noop)", async () => {
    const o = await mkOrder(S, cust, { mpPaymentId: `mp-${tag}` });
    remote(`mp-${tag}`, o.id, "approved");
    expect(await syncPayment(S, `mp-${tag}`, fake)).toBe("paid");
    expect(await syncPayment(S, `mp-${tag}`, fake)).toBe("noop");
    expect(await applyPaymentUpdate(S, o.id, "approved", `mp-${tag}`)).toBe("noop");
    expect((await order(o.id)).status).toBe("PAID");
    expect(await stock(o.variantId)).toBe(8);
  });

  it("rejected de pagamento antigo (nao e o atual) -> ignorado", async () => {
    const o = await mkOrder(S, cust, { mpPaymentId: `atual-${tag}` });
    remote(`velho-${tag}`, o.id, "rejected");
    expect(await syncPayment(S, `velho-${tag}`, fake)).toBe("noop");
    expect((await order(o.id)).status).toBe("PENDING_PAYMENT");
    expect(await stock(o.variantId)).toBe(8);
  });

  it("approved para pedido CANCELED -> nao muda nada e emite alerta PAID_FOR_CANCELED_ORDER", async () => {
    const o = await mkOrder(S, cust, { mpPaymentId: `mp-${tag}` });
    await cancelOrder(S, o.id);
    const spy = alerts();
    remote(`mp-${tag}`, o.id, "approved");
    expect(await syncPayment(S, `mp-${tag}`, fake)).toBe("alert");
    expect((await order(o.id)).status).toBe("CANCELED");
    expect(await stock(o.variantId)).toBe(10);
    expect(spy).toHaveBeenCalledWith(JSON.stringify({ alert: "PAID_FOR_CANCELED_ORDER", storeId: S, orderId: o.id, paymentId: `mp-${tag}` }));
  });

  it("valor aprovado diferente do esperado -> nao paga, alerta; Pix com o valor com desconto -> paga", async () => {
    await updateSettings(S, { pixDiscountPercent: 5 });
    const o = await mkOrder(S, cust);
    const spy = alerts();
    remote(`baixo-${tag}`, o.id, "approved", 100);
    expect(await syncPayment(S, `baixo-${tag}`, fake)).toBe("alert");
    remote(`pixcheio-${tag}`, o.id, "approved", 9501, "bank_transfer");
    expect(await syncPayment(S, `pixcheio-${tag}`, fake)).toBe("alert");
    expect((await order(o.id)).status).toBe("PENDING_PAYMENT");
    expect(spy.mock.calls.map((c) => JSON.parse(c[0] as string).alert)).toEqual(["PAYMENT_AMOUNT_MISMATCH", "PAYMENT_AMOUNT_MISMATCH"]);
    remote(`pix-${tag}`, o.id, "approved", 9500, "bank_transfer");
    expect(await syncPayment(S, `pix-${tag}`, fake)).toBe("paid");
    expect(await order(o.id)).toMatchObject({ status: "PAID", mpPaymentId: `pix-${tag}` });
  });

  it("Pix: valor cobrado fica gravado no pedido; desconto alterado no meio do Pix ainda concilia pelo valor gravado", async () => {
    await updateSettings(S, { pixDiscountPercent: 5 });
    const o = await mkOrder(S, cust, { totalCents: 10001 });
    await payOrder({ storeId: S, customerId: cust, orderId: o.id, method: "pix" }, fake);
    const db = await order(o.id);
    expect(db.pixAmountCents).toBe(9500);
    await updateSettings(S, { pixDiscountPercent: 10 }); // lojista muda o desconto com o QR ainda vigente
    const again = await payOrder({ storeId: S, customerId: cust, orderId: o.id, method: "pix" }, fake);
    expect(again.pix!.amountCents).toBe(9500); // QR reaproveitado mostra o valor dele, nao o recalculado
    fake.put({ ...fake.payments.get(db.mpPaymentId!)!, status: "approved" });
    expect(await syncPayment(S, db.mpPaymentId!, fake)).toBe("paid");
  });

  it("externalReference de pedido de outra loja -> not_found, nada muda", async () => {
    const T = await mkStore("t");
    const ot = await mkOrder(T, await mkCustomer(T, "t"));
    remote(`x-${tag}`, ot.id, "approved");
    expect(await syncPayment(S, `x-${tag}`, fake)).toBe("not_found");
    expect((await order(ot.id)).status).toBe("PENDING_PAYMENT");
  });

  it("corrida webhook approved x cancelamento: um estado final so e estoque devolvido no maximo uma vez", async () => {
    const os = await Promise.all(Array.from({ length: 6 }, () => mkOrder(S, cust)));
    await Promise.all(os.map((o, i) => prisma.order.update({ where: { id: o.id }, data: { mpPaymentId: `r${i}-${tag}` } })));
    alerts();
    await Promise.all(os.flatMap((o, i) => [
      applyPaymentUpdate(S, o.id, "approved", `r${i}-${tag}`), cancelOrder(S, o.id), applyPaymentUpdate(S, o.id, "approved", `r${i}-${tag}`), cancelOrder(S, o.id),
    ]));
    for (const o of os) {
      const { status } = await order(o.id);
      expect(["PAID", "CANCELED"]).toContain(status);
      expect(await stock(o.variantId)).toBe(status === "PAID" ? 8 : 10);
    }
  });
});

describe("expireOrders", () => {
  const now = new Date();
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it("cancela Pix vencido e pedido sem Pix ha 60+ min (estoque devolvido); pago no gateway vira PAID; ignora recentes e pagos", async () => {
    const pix = await mkOrder(S, cust, { pixExpiresAt: ago(1), mpPaymentId: `pix-${tag}`, createdAt: ago(31) });
    remote(`pix-${tag}`, pix.id, "pending", 10001, "bank_transfer");
    const old = await mkOrder(S, cust, { createdAt: ago(61) });
    const recent = await mkOrder(S, cust, { createdAt: ago(30) });
    const livePix = await mkOrder(S, cust, { pixExpiresAt: new Date(now.getTime() + 60_000), createdAt: ago(90) });
    const paid = await mkOrder(S, cust, { createdAt: ago(120) });
    await prisma.order.update({ where: { id: paid.id }, data: { status: "PAID" } });
    const lostWebhook = await mkOrder(S, cust, { pixExpiresAt: ago(2), mpPaymentId: `ok-${tag}`, createdAt: ago(32) });
    remote(`ok-${tag}`, lostWebhook.id, "approved", 10001, "bank_transfer");

    const r = await expireOrders(now);
    expect(r.failedStores).not.toContain(S);
    expect((await order(pix.id)).status).toBe("CANCELED");
    expect(await stock(pix.variantId)).toBe(10);
    expect((await order(old.id)).status).toBe("CANCELED");
    expect(await stock(old.variantId)).toBe(10);
    expect((await order(recent.id)).status).toBe("PENDING_PAYMENT");
    expect((await order(livePix.id)).status).toBe("PENDING_PAYMENT");
    expect((await order(paid.id)).status).toBe("PAID");
    expect(await stock(paid.variantId)).toBe(8);
    expect((await order(lostWebhook.id)).status).toBe("PAID");

    await expireOrders(now); // idempotente
    expect(await stock(pix.variantId)).toBe(10);
    expect(await stock(old.variantId)).toBe(10);
  });

  it("gateway da loja falha: so pedidos com pagamento sao pulados; expiracao simples de 60 min ainda cancela", async () => {
    const T = await mkStore("t");
    const withPayment = await mkOrder(S, cust, { pixExpiresAt: ago(1), mpPaymentId: `f-${tag}` });
    const plain = await mkOrder(S, cust, { createdAt: ago(61) });
    const down = await mkOrder(T, await mkCustomer(T, "u"), { pixExpiresAt: ago(1), mpPaymentId: `nao-existe-${tag}` });
    alerts();
    const gatewayFor = async (id: string): Promise<PaymentGateway> => { if (id === S) throw new Error("boom"); return fake; };
    const r = await expireOrders(now, { gatewayFor });
    expect(r.failedStores).not.toContain(S);
    expect((await order(withPayment.id)).status).toBe("PENDING_PAYMENT");
    expect((await order(plain.id)).status).toBe("CANCELED");
    expect(await stock(plain.variantId)).toBe(10);
    expect((await order(down.id)).status).toBe("PENDING_PAYMENT");
    expect(r.skipped).toBeGreaterThanOrEqual(2);
  });

  it("pagamento inexistente no gateway (404) -> pula e emite um alerta PAYMENT_UNRECONCILABLE com os pedidos", async () => {
    const a = await mkOrder(S, cust, { pixExpiresAt: ago(1), mpPaymentId: `sumiu-a-${tag}` });
    const b = await mkOrder(S, cust, { pixExpiresAt: ago(1), mpPaymentId: `sumiu-b-${tag}` });
    const spy = alerts();
    const r = await expireOrders(now);
    expect((await order(a.id)).status).toBe("PENDING_PAYMENT");
    expect(r.skipped).toBeGreaterThanOrEqual(2);
    const found = spy.mock.calls.map((c) => { try { return JSON.parse(c[0] as string); } catch { return null; } })
      .filter((x) => x?.alert === "PAYMENT_UNRECONCILABLE");
    expect(found).toHaveLength(1);
    expect(found[0].orders).toEqual(expect.arrayContaining([{ storeId: S, orderId: a.id }, { storeId: S, orderId: b.id }]));
  });

  it("erro no nivel da loja nao para as outras lojas", async () => {
    const T = await mkStore("t");
    const first = await mkOrder(S, cust, { pixExpiresAt: ago(1), mpPaymentId: `f-${tag}`, createdAt: ago(90) });
    const gone = await mkOrder(S, cust, { createdAt: ago(61) });
    const tOld = await mkOrder(T, await mkCustomer(T, "t"), { createdAt: ago(61) });
    alerts();
    // apaga o pedido seguinte de S no meio da rodada: o cancelamento dele lanca OrderNotFoundError (falha da loja)
    const gatewayFor = async (id: string): Promise<PaymentGateway> => {
      if (id === S) { await prisma.order.delete({ where: { id: gone.id } }); throw new Error("boom"); }
      return fake;
    };
    const r = await expireOrders(now, { gatewayFor });
    expect(r.failedStores).toContain(S);
    expect((await order(first.id)).status).toBe("PENDING_PAYMENT");
    expect((await order(tOld.id)).status).toBe("CANCELED");
  });

  it("syncPayment com alerta (valor divergente) -> pula o pedido, nunca cancela", async () => {
    const o = await mkOrder(S, cust, { pixExpiresAt: ago(1), mpPaymentId: `mm-${tag}` });
    remote(`mm-${tag}`, o.id, "approved", 1, "bank_transfer");
    const spy = alerts();
    const r = await expireOrders(now);
    expect((await order(o.id)).status).toBe("PENDING_PAYMENT");
    expect(await stock(o.variantId)).toBe(8);
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect(spy.mock.calls.some((c) => String(c[0]).includes("PAYMENT_AMOUNT_MISMATCH"))).toBe(true);
  });

  it("cartao pendente depois do Pix vencido -> nao cancela no vencimento do Pix (cartao ainda pode aprovar)", async () => {
    const o = await mkOrder(S, cust, { pixExpiresAt: ago(1), mpPaymentId: `card-${tag}`, createdAt: ago(31) });
    remote(`card-${tag}`, o.id, "pending");
    const r = await expireOrders(now);
    expect((await order(o.id)).status).toBe("PENDING_PAYMENT");
    expect(await stock(o.variantId)).toBe(8);
    expect(r.skipped).toBeGreaterThanOrEqual(1);
  });

  it("cartao em analise (in_process -> pending): pulado aos 61 min com estoque reservado; cancelado apos 72 h", async () => {
    const young = await mkOrder(S, cust, { mpPaymentId: `ip-a-${tag}`, createdAt: ago(61) });
    remote(`ip-a-${tag}`, young.id, "pending");
    const old = await mkOrder(S, cust, { mpPaymentId: `ip-b-${tag}`, createdAt: ago(73 * 60) });
    remote(`ip-b-${tag}`, old.id, "pending");
    await expireOrders(now);
    expect((await order(young.id)).status).toBe("PENDING_PAYMENT");
    expect(await stock(young.variantId)).toBe(8);
    expect((await order(old.id)).status).toBe("CANCELED");
    expect(await stock(old.variantId)).toBe(10);
  });

  it("Pix pendente vencido continua cancelado no vencimento (Pix vencido nao paga mais)", async () => {
    const o = await mkOrder(S, cust, { pixExpiresAt: ago(1), mpPaymentId: `pp-${tag}`, createdAt: ago(31) });
    remote(`pp-${tag}`, o.id, "pending", 10001, "bank_transfer");
    await expireOrders(now);
    expect((await order(o.id)).status).toBe("CANCELED");
  });
});
