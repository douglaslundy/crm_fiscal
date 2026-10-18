/** "37175-000", "37.175-000" ou "37175000" -> "37175000"; qualquer outra coisa -> null. */
export function normalizeCep(raw: string): string | null {
  const t = raw.trim();
  return /^\d{2}\.?\d{3}-?\d{3}$/.test(t) ? t.replace(/\D/g, "") : null;
}
