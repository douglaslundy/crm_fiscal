import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { setCredentials } from "@/domain/storeSettings";
import { fakeGateway } from "@/integrations/payments";
import { prisma } from "@/lib/db";
import { STORE_HOST_HEADER } from "@/lib/host";

vi.mock("@/auth", async (orig) => ({ ...(await orig<typeof import("@/auth")>()), getSession: vi.fn() }));
// syncPayment real; o spy so prova que assinatura invalida nao chega a ler pedidos
vi.mock("@/domain/payments", async (orig) => {
  const m = await orig<typeof import("@/domain/payments")>();
  return { ...m, syncPayment: vi.fn(m.syncPayment) };
});
const getSession = vi.mocked((await import("@/auth")).getSession);
const { syncPayment } = await import("@/domain/payments");
const pay = await import("./pay/route");
const status = await import("./order/[id]/status/route");
const config = await import("./payment-config/route");
const webhook = await import("@/app/api/webhooks/mercadopago/[storeId]/route");
const cron = await import("@/app/api/cron/expire-orders/route");

const fake = fakeGateway();
let tag: string;
let planId: string;
const stores: string[] = [];
let A: { id: string; slug: string };
let B: { id: string; slug: string };
let custA: string;
let custB: string;

const mkCustomer = async (storeId: string, k: string) =>
  (await prisma.customer.create({ data: { storeId, name: k, email: `${k}-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } })).id;
async function mkOrder(storeId: string, customerId: string, totalCents = 10001) {
  const k = Math.random().toString(36).slice(2, 8);
  const p = await prisma.product.create({ data: { storeId, slug: `p-${k}`, name: "Prod", weightGrams: 300, heightCm: 5, widthCm: 20, lengthCm: 30 } });
  const v = await prisma.variant.create({ data: { storeId, productId: p.id, sku: `S-${k}`, color: "Azul", size: "G", priceCents: 1000, stock: 8 } });
  const o = await prisma.order.create({ data: { storeId, customerId, subtotalCents: totalCents - 1000, shippingCents: 1000, totalCents, shippingService: "PAC", addressSnapshot: {} } });
  await prisma.orderItem.create({ data: { storeId, orderId: o.id, variantId: v.id, productName: "Prod", sku: "S", color: "Azul", size: "G", unitPriceCents: 1000, quantity: 2 } });
  return { id: o.id, variantId: v.id };
}
const order = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
const login = (id: string | null, storeId?: string) =>
  getSession.mockResolvedValue(id ? ({ user: { id, kind: "customer", storeId }, expires: "x" } as Session) : null);

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-PayApi" }, update: {},
    create: { name: "Teste-PayApi", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  A = await prisma.store.create({ data: { slug: `pay-a-${tag}`, name: "A", planId } });
  B = await prisma.store.create({ data: { slug: `pay-b-${tag}`, name: "B", planId } });
  stores.push(A.id, B.id);
  custA = await mkCustomer(A.id, "ca");
  custB = await mkCustomer(B.id, "cb");
  getSession.mockReset();
  vi.mocked(syncPayment).mockClear();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-PayApi" } });
  await prisma.$disconnect();
});

const req = (s: { slug: string }, path: string, method: string, body?: unknown, extra: Record<string, string> = {}) => {
  const h = { "content-type": "application/json", origin: "http://localhost", [STORE_HOST_HEADER]: `${s.slug}.localhost`, ...extra };
  return new Request(`http://localhost${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
};
const postPay = (body: unknown, s = A, extra: Record<string, string> = {}) => pay.POST(req(s, "/api/checkout/pay", "POST", body, extra));
const card = (token: string) => ({ token, installments: 1, paymentMethodId: "visa" });

describe("POST /api/checkout/pay", () => {
  it("cartao: valor do pedido no servidor (valor do cliente ignorado); aprovado -> PAID", async () => {
    const o = await mkOrder(A.id, custA);
    login(custA, A.id);
    const res = await postPay({ orderId: o.id, method: "card", card: card("approved"), amountCents: 1, totalCents: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "PAID" });
    const db = await order(o.id);
    expect(db.status).toBe("PAID");
    expect(fake.payments.get(db.mpPaymentId!)!.amountCents).toBe(10001);
  });

  it("cartao recusado -> 402 PAGAMENTO_RECUSADO e o pedido segue aguardando", async () => {
    const o = await mkOrder(A.id, custA);
    login(custA, A.id);
    const res = await postPay({ orderId: o.id, method: "card", card: card("rejected") });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "PAGAMENTO_RECUSADO" });
    expect((await order(o.id)).status).toBe("PENDING_PAYMENT");
  });

  it("Pix -> QR e copia-e-cola; pedido de outro cliente/loja -> 404; pedido pago -> 409; corpo invalido -> 400", async () => {
    const o = await mkOrder(A.id, custA);
    login(custA, A.id);
    const res = await postPay({ orderId: o.id, method: "pix" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "PENDING_PAYMENT", pix: { amountCents: 10001 } });
    expect(body.pix.qrCode).toBe((await order(o.id)).pixQrCode);
    const other = await mkOrder(A.id, await mkCustomer(A.id, "x"));
    expect((await postPay({ orderId: other.id, method: "pix" })).status).toBe(404);
    const foreign = await mkOrder(B.id, custB);
    expect((await postPay({ orderId: foreign.id, method: "pix" })).status).toBe(404);
    await prisma.order.update({ where: { id: o.id }, data: { status: "PAID" } });
    expect((await postPay({ orderId: o.id, method: "card", card: card("approved") })).status).toBe(409);
    expect((await postPay({ orderId: o.id, method: "card" })).status).toBe(400);
    expect((await postPay({ orderId: o.id, method: "card", card: { ...card("approved"), installments: 4 } })).status).toBe(400);
    expect(await order(foreign.id)).toMatchObject({ status: "PENDING_PAYMENT", mpPaymentId: null });
  });

  it("401 sem sessao; 403 CSRF; 403 loja suspensa; 429 no 11o pedido do minuto", async () => {
    const o = await mkOrder(A.id, custA);
    login(null);
    expect((await postPay({ orderId: o.id, method: "pix" })).status).toBe(401);
    login(custA, A.id);
    expect((await postPay({ orderId: o.id, method: "pix" }, A, { origin: "http://evil.example" })).status).toBe(403);
    expect((await order(o.id)).mpPaymentId).toBeNull();
    for (let i = 0; i < 10; i++) expect((await postPay({ orderId: "nao-existe", method: "pix" })).status).toBe(404);
    const limited = await postPay({ orderId: o.id, method: "pix" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    await prisma.store.update({ where: { id: A.id }, data: { status: "SUSPENDED" } });
    const susp = await postPay({ orderId: o.id, method: "pix" });
    expect(susp.status).toBe(403);
    expect(await susp.json()).toEqual({ error: "STORE_UNAVAILABLE" });
  });

  it("producao sem credenciais -> 422 PAGAMENTO_NAO_CONFIGURADO; config sem Brick e sem fake", async () => {
    const o = await mkOrder(B.id, custB);
    login(custB, B.id);
    vi.stubEnv("NODE_ENV", "production");
    const res = await postPay({ orderId: o.id, method: "pix" }, B);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "PAGAMENTO_NAO_CONFIGURADO" });
    expect(await (await config.GET(req(B, "/api/checkout/payment-config", "GET"))).json()).toEqual({ publicKey: null, fake: false });
  });

  it("gateway fora do ar -> 502 PAGAMENTO_INDISPONIVEL sem detalhe (access token da loja nunca sai)", async () => {
    const o = await mkOrder(A.id, custA);
    login(custA, A.id);
    await setCredentials(A.id, { mpAccessToken: "APP_USR-token-secreto-A", mpPublicKey: "APP_USR-pub-A" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("APP_USR-token-secreto-A"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postPay({ orderId: o.id, method: "pix" });
    expect(res.status).toBe(502);
    expect(await res.text()).toBe(JSON.stringify({ error: "PAGAMENTO_INDISPONIVEL" }));
    const cfg = await config.GET(req(A, "/api/checkout/payment-config", "GET"));
    const text = await cfg.text();
    expect(JSON.parse(text)).toEqual({ publicKey: "APP_USR-pub-A", fake: false });
    expect(text).not.toContain("token-secreto");
  });
});

describe("GET /api/checkout/order/[id]/status", () => {
  it("so o proprio pedido; 404 para pedido alheio", async () => {
    const o = await mkOrder(A.id, custA);
    const get = (id: string) => status.GET(req(A, `/api/checkout/order/${id}/status`, "GET"), { params: Promise.resolve({ id }) });
    login(custA, A.id);
    expect(await (await get(o.id)).json()).toEqual({ status: "PENDING_PAYMENT", pixQrCode: null, pixExpiresAt: null });
    const other = await mkOrder(A.id, await mkCustomer(A.id, "x"));
    expect((await get(other.id)).status).toBe(404);
    login(null);
    expect((await get(o.id)).status).toBe(401);
  });
});

describe("POST /api/webhooks/mercadopago/[storeId]", () => {
  const SECRET_A = "whsec-loja-a";
  const sign = (dataId: string, secret = SECRET_A, ts = "1760000000", reqId = "req-1") =>
    `ts=${ts},v1=${createHmac("sha256", secret).update(`id:${dataId.toLowerCase()};request-id:${reqId};ts:${ts};`).digest("hex")}`;
  const call = (storeId: string, dataId: string, sig = sign(dataId), type = "payment") =>
    webhook.POST(new Request(`http://x/api/webhooks/mercadopago/${storeId}?data.id=${dataId}&type=${type}`, {
      method: "POST",
      headers: { "x-signature": sig, "x-request-id": "req-1", "content-type": "application/json" },
      body: JSON.stringify({ type, data: { id: dataId } }),
    }), { params: Promise.resolve({ storeId }) });
  const remote = (id: string, orderId: string, st: "approved" | "rejected", amountCents = 10001) =>
    fake.put({ id, status: st, externalReference: orderId, amountCents, paymentTypeId: "credit_card" });

  it("assinatura valida: relê o pagamento e marca PAID; repetido -> uma transicao so", async () => {
    await setCredentials(A.id, { mpWebhookSecret: SECRET_A });
    const o = await mkOrder(A.id, custA);
    await prisma.order.update({ where: { id: o.id }, data: { mpPaymentId: `mp-${tag}` } });
    remote(`mp-${tag}`, o.id, "approved");
    for (let i = 0; i < 3; i++) expect((await call(A.id, `mp-${tag}`)).status).toBe(200);
    expect(await order(o.id)).toMatchObject({ status: "PAID", mpPaymentId: `mp-${tag}` });
    expect(await prisma.variant.findUniqueOrThrow({ where: { id: o.variantId } })).toMatchObject({ stock: 8 });
    expect(await Promise.all(vi.mocked(syncPayment).mock.results.map((r) => r.value))).toEqual(["paid", "noop", "noop"]);
  });

  it("assinatura invalida (outro segredo, outro id, vazia) -> 401 sem ler pedidos", async () => {
    await setCredentials(A.id, { mpWebhookSecret: SECRET_A });
    await setCredentials(B.id, { mpWebhookSecret: "whsec-loja-b" });
    const o = await mkOrder(A.id, custA);
    remote(`mp-${tag}`, o.id, "approved");
    const get = vi.spyOn(fake, "getPayment");
    expect((await call(A.id, `mp-${tag}`, sign(`mp-${tag}`, "whsec-loja-b"))).status).toBe(401);
    expect((await call(A.id, `mp-${tag}`, sign("outro-id"))).status).toBe(401);
    expect((await call(A.id, `mp-${tag}`, "")).status).toBe(401);
    expect(syncPayment).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect((await order(o.id)).status).toBe("PENDING_PAYMENT");
  });

  it("loja sem segredo -> 401 (sem segredo padrao); loja desconhecida -> 404", async () => {
    const o = await mkOrder(A.id, custA);
    remote(`mp-${tag}`, o.id, "approved");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call(A.id, `mp-${tag}`, sign(`mp-${tag}`, ""))).status).toBe(401);
    expect(log).toHaveBeenCalled();
    expect((await call(`nao-existe-${tag}`, `mp-${tag}`)).status).toBe(404);
    expect(syncPayment).not.toHaveBeenCalled();
    expect((await order(o.id)).status).toBe("PENDING_PAYMENT");
  });

  it("webhook da loja A com pedido da loja B -> 404 e nada muda", async () => {
    await setCredentials(A.id, { mpWebhookSecret: SECRET_A });
    const ob = await mkOrder(B.id, custB);
    remote(`mp-${tag}`, ob.id, "approved");
    expect((await call(A.id, `mp-${tag}`)).status).toBe(404);
    expect((await order(ob.id)).status).toBe("PENDING_PAYMENT");
  });

  it("rejected do pagamento atual -> CANCELED com estoque devolvido; tipo diferente de payment -> 200 sem efeito", async () => {
    await setCredentials(A.id, { mpWebhookSecret: SECRET_A });
    const o = await mkOrder(A.id, custA);
    await prisma.order.update({ where: { id: o.id }, data: { mpPaymentId: `mp-${tag}` } });
    remote(`mp-${tag}`, o.id, "rejected");
    expect((await call(A.id, `mp-${tag}`, sign(`mp-${tag}`), "merchant_order")).status).toBe(200);
    expect((await order(o.id)).status).toBe("PENDING_PAYMENT");
    expect((await call(A.id, `mp-${tag}`)).status).toBe(200);
    expect((await order(o.id)).status).toBe("CANCELED");
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: o.variantId } })).stock).toBe(10);
    expect((await call(A.id, `mp-${tag}`)).status).toBe(200);
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: o.variantId } })).stock).toBe(10);
  });

  it("gateway fora do ar -> 503 (o MP reenvia)", async () => {
    await setCredentials(A.id, { mpWebhookSecret: SECRET_A });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call(A.id, `inexistente-${tag}`)).status).toBe(503);
  });
});

describe("GET /api/cron/expire-orders", () => {
  it("exige CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secreto");
    const get = (auth?: string) => cron.GET(new Request("http://x/api/cron/expire-orders", { headers: auth ? { authorization: auth } : {} }));
    expect((await get()).status).toBe(401);
    expect((await get("Bearer errado")).status).toBe(401);
    const res = await get("Bearer cron-secreto");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ canceled: expect.any(Number), failedStores: expect.any(Array) });
    vi.stubEnv("CRON_SECRET", "");
    expect((await get("Bearer ")).status).toBe(401);
  });
});
