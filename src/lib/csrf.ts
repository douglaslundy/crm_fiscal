import { NextResponse } from "next/server";
import { normalizeHost, platformDomain } from "./host";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const deny = (error: string) => NextResponse.json({ error }, { status: 403 });

/**
 * Defesa CSRF para route handlers autenticados por cookie. Retorna 403 (JSON) ou null se ok.
 * - Origin presente: o host dele deve ser o Host da propria requisicao (o middleware so repassa host de loja
 *   confiavel; Host e o que o proxy da plataforma entregou) ou o dominio configurado da plataforma.
 * - Origin ausente: so passa com Sec-Fetch-Site same-origin ou none. Escolha: navegadores sempre mandam Origin em
 *   POST/PATCH/DELETE cross-site, entao a ausencia vem de cliente nao-navegador (curl/server-to-server, que nao carrega
 *   cookie de vitima) ou de navegador antigo; sem sinal nenhum recusamos (fail closed).
 * - Corpo presente: Content-Type deve ser application/json (form/text/plain cross-site nao dispara preflight).
 *   `allowMultipart` (so a rota de upload): troca a exigencia por multipart/form-data; Origin continua obrigatorio
 *   como acima, que e o que barra o form cross-site (multipart nao dispara preflight).
 */
export function assertSameOriginJson(req: Request, opts: { allowMultipart?: boolean } = {}): Response | null {
  if (SAFE.has(req.method.toUpperCase())) return null;
  const origin = req.headers.get("origin");
  if (origin !== null) {
    let host: string;
    try { host = new URL(origin).host.toLowerCase(); } catch { return deny("Origem inválida."); }
    const own = (req.headers.get("host") ?? new URL(req.url).host).toLowerCase();
    if (host !== own && normalizeHost(host) !== normalizeHost(platformDomain())) return deny("Origem não permitida.");
  } else {
    const site = req.headers.get("sec-fetch-site");
    if (site !== "same-origin" && site !== "none") return deny("Origem não verificada.");
  }
  if (req.body !== null) {
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const want = opts.allowMultipart ? "multipart/form-data" : "application/json";
    if (type !== want) return deny(`Content-Type deve ser ${want}.`);
  }
  return null;
}
