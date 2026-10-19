const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Maior valor em centavos que cabe nas colunas Int (int4) do banco. */
export const MAX_CENTS = 2_147_483_647;

export const formatBRL = (cents: number): string => brl.format(cents / 100);

/** Mais parcelas possiveis (1..max) sem nenhuma ficar abaixo do minimo; parcela arredondada para cima. */
export function installments(priceCents: number, minInstallmentCents = 9000, maxInstallments = 3): { count: number; valueCents: number } {
  const count = Math.max(1, Math.min(maxInstallments, Math.floor(priceCents / minInstallmentCents)));
  return { count, valueCents: Math.ceil(priceCents / count) };
}

/** Preco no Pix com desconto percentual da loja (centavo arredondado para baixo). */
export const pixPriceCents = (priceCents: number, percent: number): number => Math.floor((priceCents * (100 - percent)) / 100);
