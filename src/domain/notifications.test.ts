import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeSender } from "@/integrations/email";
import { applyPaymentUpdate } from "./payments";

let tag: string;
let planId: string;
const stores: string[] = [];

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-Ntf" }, update: {},
    create: { name: "Teste-Ntf", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  fakeSender.sent.length = 0;
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Ntf" } });
  await prisma.$disconnect();
});

describe("confirmacao de pagamento por e-mail", () => {
  it("pedido aprovado envia uma vez ao cliente; webhook repetido nao reenvia", async () => {
    const s = await prisma.store.create({ data: { slug: `ntf-${tag}`, name: "Loja Ntf", planId } });
    stores.push(s.id);
    const c = await prisma.customer.create({ data: { storeId: s.id, name: "Ana Souza", email: `c-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } });
    const o = await prisma.order.create({ data: { storeId: s.id, customerId: c.id, status: "PENDING_PAYMENT", subtotalCents: 5000, shippingCents: 0, totalCents: 5000, shippingService: "PAC", addressSnapshot: {} } });
    expect(await applyPaymentUpdate(s.id, o.id, "approved", "mp-1")).toBe("paid");
    expect(await applyPaymentUpdate(s.id, o.id, "approved", "mp-1")).toBe("noop");
    await new Promise((r) => setTimeout(r, 300)); // envio e assincrono (nao segura o pagamento)
    expect(fakeSender.sent).toHaveLength(1);
    expect(fakeSender.sent[0]).toMatchObject({ to: `c-${tag}@t.local`, subject: "Pagamento confirmado - Loja Ntf" });
    expect(fakeSender.sent[0].text).toContain(`/pedido/${o.id}`);
    expect(fakeSender.sent[0].text.replace(/ /g, " ")).toContain("R$ 50,00");
  });
});
