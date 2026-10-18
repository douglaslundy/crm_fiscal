export type CartLine = { variantId: string; qty: number };
export type VariantRow = {
  id: string; productId: string; productName: string; color: string; size: string; sku: string;
  priceCents: number; stock: number; active: boolean; imageUrl: string | null;
};
export type PricedLine = {
  variantId: string; productName: string; color: string; size: string; qty: number; unitCents: number; lineCents: number; imageUrl: string | null;
};
export type CartIssue = { variantId: string; kind: "INACTIVE" | "OUT_OF_STOCK" | "QTY_REDUCED"; available: number };

export const MAX_QTY = 99;

/**
 * Pura: preco, estoque e atividade vem sempre de `variants` (carregadas da loja atual), nunca da linha.
 * Variacao ausente em `variants` (inexistente, de outra loja ou de produto inativo) = INACTIVE. Ordem = entrada.
 */
export function priceCart(lines: CartLine[], variants: VariantRow[]): { lines: PricedLine[]; subtotalCents: number; issues: CartIssue[] } {
  const qtys = new Map<string, number>();
  for (const l of lines) if (Number.isInteger(l.qty) && l.qty > 0) qtys.set(l.variantId, Math.min(MAX_QTY, (qtys.get(l.variantId) ?? 0) + l.qty));
  const byId = new Map(variants.map((x) => [x.id, x]));
  const out: PricedLine[] = [];
  const issues: CartIssue[] = [];
  for (const [variantId, wanted] of qtys) {
    const x = byId.get(variantId);
    if (!x || !x.active) { issues.push({ variantId, kind: "INACTIVE", available: 0 }); continue; }
    if (x.stock <= 0) { issues.push({ variantId, kind: "OUT_OF_STOCK", available: 0 }); continue; }
    const qty = Math.min(wanted, x.stock);
    if (qty < wanted) issues.push({ variantId, kind: "QTY_REDUCED", available: x.stock });
    out.push({ variantId, productName: x.productName, color: x.color, size: x.size, qty, unitCents: x.priceCents, lineCents: x.priceCents * qty, imageUrl: x.imageUrl });
  }
  return { lines: out, subtotalCents: out.reduce((s, l) => s + l.lineCents, 0), issues };
}
