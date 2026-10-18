// Gateway de frete (Melhor Envio; FakeShipping sem token, so fora de producao).
export type Package = { weightGrams: number; heightCm: number; widthCm: number; lengthCm: number; insuranceCents: number };
export type ShippingOption = { service: string; priceCents: number; days: number };

export interface ShippingProvider {
  quote(input: { fromCep: string; toCep: string; packages: Package[] }): Promise<ShippingOption[]>;
}

export class ShippingError extends Error {
  name = "ShippingError";
}
