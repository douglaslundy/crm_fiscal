import { slugify } from "./slug";

// Puro (sem banco): usado no servidor e no gerador de variacoes do formulario.
export type VariantInput = { color: string; size: string; sku: string; priceCents: number; stock: number };

export type VariantsErrorCode = "TOO_MANY_VARIANTS" | "INVALID_PRICE" | "INVALID_STOCK" | "INVALID_OPTION";
export class VariantsError extends Error {
  name = "VariantsError";
  constructor(readonly code: VariantsErrorCode, message: string) {
    super(message);
  }
}

export const MAX_VARIANTS = 100;
export const OPTION_MAX = 30;

/** Apara, valida (1-30, com letra/numero) e remove repetidas pela chave do SKU (sem acento, sem maiuscula). */
function options(list: string[]): { label: string; key: string }[] {
  const seen = new Map<string, string>();
  for (const raw of list) {
    const label = raw.trim();
    if (!label) continue;
    const key = slugify(label);
    if (label.length > OPTION_MAX || !key) throw new VariantsError("INVALID_OPTION", `Cor/tamanho inválido: "${label}" (1 a ${OPTION_MAX} caracteres, com letra ou número).`);
    if (!seen.has(key)) seen.set(key, label);
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}

/** Produto cartesiano cor x tamanho com SKU `prefixo-cor-tamanho` (minusculo, sem acento, unico). */
export function expandVariants(colors: string[], sizes: string[], base: { priceCents: number; stock: number }, skuPrefix: string): VariantInput[] {
  if (!Number.isInteger(base.priceCents) || base.priceCents < 1) throw new VariantsError("INVALID_PRICE", "Preço deve ser um inteiro em centavos maior que zero.");
  if (!Number.isInteger(base.stock) || base.stock < 0) throw new VariantsError("INVALID_STOCK", "Estoque deve ser um inteiro maior ou igual a zero.");
  const cs = options(colors);
  const ss = options(sizes);
  if (cs.length * ss.length > MAX_VARIANTS) throw new VariantsError("TOO_MANY_VARIANTS", `No máximo ${MAX_VARIANTS} variações por produto.`);
  const prefix = slugify(skuPrefix);
  return cs.flatMap((c) => ss.map((s) => ({
    color: c.label,
    size: s.label,
    sku: [prefix, c.key, s.key].filter(Boolean).join("-"),
    priceCents: base.priceCents,
    stock: base.stock,
  })));
}
