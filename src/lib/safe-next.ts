/** Destino pos-login: so caminho relativo do mesmo site ("/x"); nunca "//host", "/\\host", URL absoluta ou controle. */
export function safeNext(raw: unknown, fallback: string): string {
  return typeof raw === "string" && /^\/(?![/\\])/.test(raw) && !/[\\\x00-\x1f\x7f]/.test(raw) ? raw : fallback;
}
