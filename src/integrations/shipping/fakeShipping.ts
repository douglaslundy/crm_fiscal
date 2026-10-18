import type { Package, ShippingOption, ShippingProvider } from "./types";

/** Deterministico e sem rede (so desenvolvimento/testes): preco sobe com o peso total e varia com o CEP de destino. */
export class FakeShipping implements ShippingProvider {
  async quote({ toCep, packages }: { fromCep: string; toCep: string; packages: Package[] }): Promise<ShippingOption[]> {
    const grams = packages.reduce((s, p) => s + p.weightGrams, 0);
    const zone = [...toCep].reduce((s, c) => s + Number(c), 0) % 7;
    const pac = 1500 + Math.ceil(grams / 500) * 300 + zone * 50;
    return [{ service: "PAC", priceCents: pac, days: 5 + zone }, { service: "SEDEX", priceCents: pac * 2, days: 2 + (zone % 3) }];
  }
}
