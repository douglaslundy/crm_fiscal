import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { SubscribeBody, SubscriberNotFoundError, exportSubscribersCsv, listSubscribers, removeSubscriber, subscribe } from "./subscribers";

let tag: string;
let planId: string;
const stores: string[] = [];
let S: string;

const mkStore = async (k: string) => {
  const s = await prisma.store.create({ data: { slug: `sub-${k}-${tag}`, name: `Loja ${k}`, planId } });
  stores.push(s.id);
  return s.id;
};

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-Sub" }, update: {},
    create: { name: "Teste-Sub", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  S = await mkStore("s");
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Sub" } });
  await prisma.$disconnect();
});

describe("inscritos", () => {
  it("repetido nao duplica; mesmo e-mail em outra loja e outro inscrito; lista e isola", async () => {
    await subscribe(S, "a@t.local");
    await subscribe(S, "a@t.local");
    const other = await mkStore("o");
    await subscribe(other, "a@t.local");
    const { items, total } = await listSubscribers(S);
    expect([total, items.map((i) => i.email)]).toEqual([1, ["a@t.local"]]);
    expect((await listSubscribers(other)).total).toBe(1);
  });
  it("remover: so da propria loja; inexistente = erro", async () => {
    await subscribe(S, "a@t.local");
    const [{ id }] = (await listSubscribers(S)).items;
    const other = await mkStore("o2");
    await expect(removeSubscriber(other, id)).rejects.toBeInstanceOf(SubscriberNotFoundError);
    await removeSubscriber(S, id);
    expect((await listSubscribers(S)).total).toBe(0);
    await expect(removeSubscriber(S, id)).rejects.toBeInstanceOf(SubscriberNotFoundError);
  });
  it("CSV cronologico, com protecao contra formula", async () => {
    await subscribe(S, "=cmd@t.local");
    await new Promise((r) => setTimeout(r, 5));
    await subscribe(S, "b@t.local");
    const lines = (await exportSubscribersCsv(S)).trimEnd().split("\r\n");
    expect(lines[0]).toBe("email,inscrito_em");
    expect(lines[1]).toMatch(/^'=cmd@t\.local,/);
    expect(lines[2]).toMatch(/^b@t\.local,/);
  });
  it("schema: exige consentimento true e e-mail valido, normaliza", () => {
    expect(SubscribeBody.parse({ email: " A@T.Local ", consent: true })).toEqual({ email: "a@t.local", consent: true });
    for (const bad of [{ email: "a@t.local" }, { email: "a@t.local", consent: false }, { email: "x", consent: true }]) {
      expect(SubscribeBody.safeParse(bad).success).toBe(false);
    }
  });
});
