/**
 * Janela fixa em memoria (por processo). Mapa limitado: passou de `maxKeys`, descarta a chave mais antiga.
 * shortcut: nao e compartilhado entre instancias; trocar por Redis se houver varias replicas.
 */
export function createRateLimiter({ limit, windowMs, maxKeys = 5000, now = Date.now }: { limit: number; windowMs: number; maxKeys?: number; now?: () => number }) {
  const hits = new Map<string, { start: number; count: number }>();
  return {
    /** ok=false => estourou; retryAfterSec = segundos ate a janela abrir. */
    check(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
      const t = now();
      let e = hits.get(key);
      if (!e || t - e.start >= windowMs) {
        hits.delete(key);
        e = { start: t, count: 0 };
        hits.set(key, e);
        while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
      }
      e.count++;
      return e.count > limit ? { ok: false, retryAfterSec: Math.max(1, Math.ceil((e.start + windowMs - t) / 1000)) } : { ok: true };
    },
    clear: () => hits.clear(),
  };
}

/** Primeiro salto de x-forwarded-for, senao x-real-ip, senao "unknown". */
export function clientIp(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}
