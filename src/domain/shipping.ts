import { createHash } from "node:crypto";
import type { PricedLine } from "./cart";
import type { Package, ShippingOption } from "@/integrations/shipping/types";

export type Dims = { weightGrams: number; heightCm: number; widthCm: number; lengthCm: number };

// Regras dos Correios (unico lugar das constantes).
export const MINIMUMS = { weightGrams: 100, heightCm: 2, widthCm: 11, lengthCm: 16 };
export const LIMITS = { weightGrams: 30000, sideCm: 105, sumCm: 200 };

/**
 * Pacotes a cotar. `dims` = peso/dimensoes do produto por variantId (vem do banco, nunca do navegador).
 * Altura empilha, largura/comprimento = maior item; passou de um limite, abre outro pacote (guloso por unidade).
 * Linha sem dimensoes e ignorada. Seguro do pacote = soma do preco das unidades nele.
 * shortcut: empacotamento guloso, nao otimo; trocar se o frete ficar caro demais para pedidos grandes.
 */
export function buildPackages(lines: PricedLine[], dims: Map<string, Dims>): Package[] {
  const out: Package[] = [];
  let cur: Package | null = null;
  const fits = (p: Package) =>
    p.weightGrams <= LIMITS.weightGrams && Math.max(p.heightCm, p.widthCm, p.lengthCm) <= LIMITS.sideCm &&
    p.heightCm + p.widthCm + p.lengthCm <= LIMITS.sumCm;
  for (const l of lines) {
    const d = dims.get(l.variantId);
    if (!d) continue;
    for (let i = 0; i < l.qty; i++) {
      const alone: Package = { weightGrams: d.weightGrams, heightCm: d.heightCm, widthCm: d.widthCm, lengthCm: d.lengthCm, insuranceCents: l.unitCents };
      const merged: Package | null = cur && {
        weightGrams: cur.weightGrams + d.weightGrams, heightCm: cur.heightCm + d.heightCm,
        widthCm: Math.max(cur.widthCm, d.widthCm), lengthCm: Math.max(cur.lengthCm, d.lengthCm), insuranceCents: cur.insuranceCents + l.unitCents,
      };
      if (merged && fits(merged)) cur = merged;
      else { if (cur) out.push(cur); cur = alone; }
    }
  }
  if (cur) out.push(cur);
  return out.map((p) => ({
    ...p,
    weightGrams: Math.max(p.weightGrams, MINIMUMS.weightGrams), heightCm: Math.max(p.heightCm, MINIMUMS.heightCm),
    widthCm: Math.max(p.widthCm, MINIMUMS.widthCm), lengthCm: Math.max(p.lengthCm, MINIMUMS.lengthCm),
  }));
}

export const packagesHash = (pk: Package[]) => createHash("sha256").update(JSON.stringify(pk)).digest("hex");

/** Cache em memoria (por processo): chave inclui a loja, entao lojas nunca compartilham cotacao. Limite = descarta o mais antigo. */
export function createQuoteCache({ ttlMs = 10 * 60 * 1000, max = 500, now = Date.now }: { ttlMs?: number; max?: number; now?: () => number } = {}) {
  const m = new Map<string, { at: number; options: ShippingOption[] }>();
  const key = (storeId: string, toCep: string, fromCep: string, pk: Package[]) => `${storeId}|${fromCep}|${toCep}|${packagesHash(pk)}`;
  return {
    get(storeId: string, toCep: string, fromCep: string, pk: Package[]) {
      const k = key(storeId, toCep, fromCep, pk);
      const e = m.get(k);
      if (!e) return undefined;
      if (now() - e.at > ttlMs) { m.delete(k); return undefined; }
      return e.options;
    },
    set(storeId: string, toCep: string, fromCep: string, pk: Package[], options: ShippingOption[]) {
      const k = key(storeId, toCep, fromCep, pk);
      m.delete(k);
      m.set(k, { at: now(), options });
      while (m.size > max) m.delete(m.keys().next().value as string);
    },
    clear: () => m.clear(),
  };
}
export const quoteCache = createQuoteCache();
