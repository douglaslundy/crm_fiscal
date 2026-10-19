import type { CartLine } from "@/domain/cart";

// Carrinho no navegador, por loja. Nunca e fonte de verdade: o servidor revalida (POST /api/cart/price).
const EMPTY: CartLine[] = [];
const listeners = new Set<() => void>();
let snapshot: { key: string; raw: string | null; lines: CartLine[] } | null = null;

const keyOf = () => `cart:${typeof location === "undefined" ? "" : location.host}`;

function parse(raw: string | null): CartLine[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return EMPTY;
    return v.filter((l): l is CartLine => !!l && typeof l.variantId === "string" && Number.isInteger(l.qty) && l.qty > 0);
  } catch {
    return EMPTY;
  }
}

/** Referencia estavel enquanto o conteudo nao muda (exigido por useSyncExternalStore). */
export function read(): CartLine[] {
  if (typeof localStorage === "undefined") return EMPTY;
  const key = keyOf();
  let raw: string | null = null;
  try { raw = localStorage.getItem(key); } catch { /* storage bloqueado: carrinho vazio */ }
  if (!snapshot || snapshot.key !== key || snapshot.raw !== raw) snapshot = { key, raw, lines: parse(raw) };
  return snapshot.lines;
}

/** false se o navegador recusou gravar (storage bloqueado/cheio); nesse caso nada muda. */
function write(lines: CartLine[]): boolean {
  try { localStorage.setItem(keyOf(), JSON.stringify(lines)); } catch { return false; }
  listeners.forEach((l) => l());
  return true;
}

/** Soma qty a variacao (qty nao inteira ou <= 0 e ignorada). */
export function add(variantId: string, qty = 1): boolean {
  if (!Number.isInteger(qty) || qty <= 0) return false;
  const cur = read();
  return write(cur.some((l) => l.variantId === variantId)
    ? cur.map((l) => (l.variantId === variantId ? { ...l, qty: l.qty + qty } : l))
    : [...cur, { variantId, qty }]);
}

/** qty <= 0 remove a linha. */
export function setQty(variantId: string, qty: number): boolean {
  if (!Number.isInteger(qty)) return false;
  return write(qty <= 0 ? read().filter((l) => l.variantId !== variantId) : read().map((l) => (l.variantId === variantId ? { ...l, qty } : l)));
}

export const remove = (variantId: string): boolean => write(read().filter((l) => l.variantId !== variantId));
export const clear = (): boolean => write([]);
/** Troca o conteudo todo (usado para aplicar a correcao do servidor). */
export const replace = (lines: CartLine[]): boolean => write(lines);

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb); // outras abas
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
}

export const serverSnapshot = (): CartLine[] => EMPTY;
