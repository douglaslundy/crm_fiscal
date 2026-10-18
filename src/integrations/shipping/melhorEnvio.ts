import { ShippingError, type Package, type ShippingOption, type ShippingProvider } from "./types";

const TIMEOUT_MS = 8000;
const FALLBACK_UA = "Plataforma Lojas (contato@invalid.example)";

export type MelhorEnvioDeps = { token: string; fetch?: typeof fetch; baseUrl?: string; userAgent?: string };

/** "12.34" -> 1234 sem float; numero JSON tambem aceito. null = valor invalido. */
export function toCents(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  const m = typeof v === "string" ? /^(\d+)(?:\.(\d{1,2}))?$/.exec(v.trim()) : null;
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : null;
}

/**
 * Melhor Envio: POST /api/v2/me/shipment/calculate, formato `products` (id, width, height, length, weight em kg,
 * insurance_value em reais, quantity). Cada pacote nosso vai como 1 "produto"; o token da loja so vai no cabecalho.
 * Sem token real ainda: exercitado so com fetch injetado nos testes.
 */
export class MelhorEnvioShipping implements ShippingProvider {
  constructor(private readonly deps: MelhorEnvioDeps) {}

  async quote({ fromCep, toCep, packages }: { fromCep: string; toCep: string; packages: Package[] }): Promise<ShippingOption[]> {
    const base = this.deps.baseUrl ?? process.env.MELHOR_ENVIO_BASE_URL ?? "https://melhorenvio.com.br";
    const body = {
      from: { postal_code: fromCep },
      to: { postal_code: toCep },
      products: packages.map((p, i) => ({
        id: String(i + 1), width: p.widthCm, height: p.heightCm, length: p.lengthCm,
        weight: p.weightGrams / 1000, insurance_value: p.insuranceCents / 100, quantity: 1,
      })),
    };
    let data: unknown;
    try {
      const res = await (this.deps.fetch ?? fetch)(`${base}/api/v2/me/shipment/calculate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.deps.token}`, Accept: "application/json", "Content-Type": "application/json",
          "User-Agent": this.deps.userAgent ?? process.env.MELHOR_ENVIO_USER_AGENT ?? FALLBACK_UA,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new ShippingError(`Melhor Envio respondeu ${res.status}`);
      data = await res.json();
    } catch (e) {
      // mensagem fixa: nada do erro original (pode citar cabecalhos) sai daqui
      throw e instanceof ShippingError ? e : new ShippingError("Falha ao consultar o Melhor Envio");
    }
    if (!Array.isArray(data)) throw new ShippingError("Resposta inesperada do Melhor Envio");
    const options: ShippingOption[] = [];
    for (const raw of data) {
      const o = (raw ?? {}) as Record<string, unknown>;
      if (o.error) continue;
      const priceCents = toCents(o.custom_price ?? o.price);
      const days = Number(o.custom_delivery_time ?? o.delivery_time);
      if (priceCents === null || !Number.isInteger(days) || days < 0 || typeof o.name !== "string") continue;
      const company = (o.company as { name?: unknown } | undefined)?.name;
      options.push({ service: typeof company === "string" ? `${company} ${o.name}` : o.name, priceCents, days });
    }
    return options.sort((a, b) => a.priceCents - b.priceCents);
  }
}
