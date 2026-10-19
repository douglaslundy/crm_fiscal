import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { SettingsError } from "./storeSettings";
import { getTheme, textOn, updateTheme } from "./theme";

let tag: string;
let planId: string;
const stores: string[] = [];
let S: string;

const mkStore = async (k: string) => {
  const s = await prisma.store.create({ data: { slug: `thm-${k}-${tag}`, name: `Loja ${k}`, planId } });
  stores.push(s.id);
  return s.id;
};
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof SettingsError ? `${e.status} ${e.code}` : String(e)));

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-Thm" }, update: {},
    create: { name: "Teste-Thm", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  S = await mkStore("s");
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Thm" } });
  await prisma.$disconnect();
});

describe("tema", () => {
  it("padrao nulo; grava cor (minuscula) e logo; parcial mantem o outro; vazio/null volta ao padrao", async () => {
    expect(await getTheme(S)).toEqual({ primaryColor: null, logoUrl: null });
    await updateTheme(S, { primaryColor: "#A1B2C3", logoUrl: "https://cdn.exemplo.com/logo.png" });
    expect(await getTheme(S)).toEqual({ primaryColor: "#a1b2c3", logoUrl: "https://cdn.exemplo.com/logo.png" });
    await updateTheme(S, { primaryColor: "#000000" });
    expect(await getTheme(S)).toEqual({ primaryColor: "#000000", logoUrl: "https://cdn.exemplo.com/logo.png" });
    await updateTheme(S, { primaryColor: null, logoUrl: "" });
    expect(await getTheme(S)).toEqual({ primaryColor: null, logoUrl: null });
  });
  it("recusa cor fora de #rrggbb e logo que nao e https (nada de javascript:/data:)", async () => {
    for (const bad of [{ primaryColor: "red" }, { primaryColor: "#fff" }, { primaryColor: "#12345g" }, { primaryColor: "url(x)" },
      { logoUrl: "http://x.com/a.png" }, { logoUrl: "javascript:alert(1)" }, { logoUrl: "data:image/png;base64,AA" }, { logoUrl: "nao e url" }]) {
      expect(await code(updateTheme(S, bad)), JSON.stringify(bad)).toBe("400 THEME_INVALID");
    }
    expect(await getTheme(S)).toEqual({ primaryColor: null, logoUrl: null });
  });
  it("isolado por loja", async () => {
    const other = await mkStore("o");
    await updateTheme(S, { primaryColor: "#ff0000" });
    expect((await getTheme(other)).primaryColor).toBeNull();
  });
  it("texto sobre a cor: claro em fundo escuro, escuro em fundo claro", () => {
    expect(textOn("#111111")).toBe("#ffffff");
    expect(textOn("#ffffff")).toBe("#000000");
    expect(textOn("#ffff00")).toBe("#000000");
    expect(textOn("#0000ff")).toBe("#ffffff");
  });
});
