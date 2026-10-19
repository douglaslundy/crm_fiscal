import { NextResponse } from "next/server";
import { z } from "zod";
import { priceStoreCart } from "@/domain/cartServer";
import { normalizeCep } from "@/domain/cep";
import { buildPackages, hasOversizeItem, quoteCache, quotePackages } from "@/domain/shipping";
import { getSettings, getStoreCredentials } from "@/domain/storeSettings";
import { isStoreBlocked } from "@/domain/subscription";
import { getShippingProvider } from "@/integrations/shipping";
import type { ShippingOption } from "@/integrations/shipping/types";
import { assertSameOriginJson } from "@/lib/csrf";
import { dbForStore } from "@/lib/db-store";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { getCurrentStore } from "@/lib/tenant";

const quoteLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
const inflight = new Map<string, Promise<ShippingOption[]>>(); // cotacoes identicas simultaneas dividem 1 chamada

const Body = z.object({
  cep: z.string().max(20),
  lines: z.array(z.object({ variantId: z.string().max(64), qty: z.number().finite() })).max(50),
});

/** Publico: cota frete por CEP. Preco, peso e dimensoes vem do banco (da loja do host); o token Melhor Envio da loja nunca sai do servidor. */
export async function POST(req: Request) {
  const csrf = assertSameOriginJson(req);
  if (csrf) return csrf;
  const store = await getCurrentStore();
  if (isStoreBlocked(store)) return NextResponse.json({ error: "STORE_UNAVAILABLE" }, { status: 403 });
  const rl = quoteLimiter.check(`${store.id}|${clientIp(req.headers)}`);
  if (!rl.ok) return NextResponse.json({ error: "MUITAS_REQUISICOES" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  const toCep = normalizeCep(parsed.data.cep);
  if (!toCep) return NextResponse.json({ error: "CEP_INVALIDO" }, { status: 400 });

  const priced = await priceStoreCart(store.id, parsed.data.lines);
  if (priced.lines.length === 0) return NextResponse.json({ error: "CARRINHO_VAZIO", issues: priced.issues }, { status: 400 });

  const provider = getShippingProvider((await getStoreCredentials(store.id)).melhorEnvioToken);
  if (!provider) return NextResponse.json({ error: "FRETE_NAO_CONFIGURADO" }, { status: 422 });

  const rows = await dbForStore(store.id).variant.findMany({
    where: { id: { in: priced.lines.map((l) => l.variantId) } },
    select: { id: true, product: { select: { weightGrams: true, heightCm: true, widthCm: true, lengthCm: true } } },
  });
  const dims = new Map(rows.map((r) => [r.id, r.product]));
  if (hasOversizeItem(priced.lines, dims)) return NextResponse.json({ error: "ITEM_FORA_DOS_LIMITES" }, { status: 422 });
  const packages = buildPackages(priced.lines, dims);
  if (packages.length === 0) return NextResponse.json({ error: "CARRINHO_VAZIO", issues: priced.issues }, { status: 400 });
  const { originCep } = await getSettings(store.id);

  let options = quoteCache.get(store.id, toCep, originCep, packages);
  if (!options) {
    const k = quoteCache.key(store.id, toCep, originCep, packages);
    let p = inflight.get(k);
    if (!p) {
      p = quotePackages(provider, { fromCep: originCep, toCep, packages }).finally(() => inflight.delete(k));
      inflight.set(k, p);
    }
    try {
      options = await p;
    } catch {
      return NextResponse.json({ error: "FRETE_INDISPONIVEL" }, { status: 502 });
    }
    if (options.length > 0) quoteCache.set(store.id, toCep, originCep, packages, options);
  }
  return NextResponse.json({ options, issues: priced.issues });
}
