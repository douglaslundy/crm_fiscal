import { describe, expect, it } from "vitest";
import { formatBRL, installments, pixPriceCents } from "@/domain/money";

describe("formatBRL", () => {
  it("formata centavos em reais", () => {
    const s = formatBRL(8990);
    expect(s).toContain("R$");
    expect(s).toContain("89,90");
  });
});

describe("installments", () => {
  it("parcela minima de R$ 90,00, no maximo 3x", () => {
    expect(installments(8990)).toEqual({ count: 1, valueCents: 8990 });
    expect(installments(27000)).toEqual({ count: 3, valueCents: 9000 });
    expect(installments(10000)).toEqual({ count: 1, valueCents: 10000 });
    expect(installments(18000)).toEqual({ count: 2, valueCents: 9000 });
    expect(installments(90000)).toEqual({ count: 3, valueCents: 30000 });
  });
  it("valor nao exato arredonda a parcela para baixo (soma nunca passa do preco); nunca abaixo do minimo", () => {
    expect(installments(27001)).toEqual({ count: 3, valueCents: 9000 });
    expect(installments(26999)).toEqual({ count: 2, valueCents: 13499 });
    expect(installments(100000, 9000, 3)).toEqual({ count: 3, valueCents: 33333 });
    for (const p of [27001, 26999, 100000, 99999, 12345678]) {
      const { count, valueCents } = installments(p);
      expect(count * valueCents, String(p)).toBeLessThanOrEqual(p);
    }
  });
  it("limites: valor baixo/zero -> 1x; parametros customizados", () => {
    expect(installments(0)).toEqual({ count: 1, valueCents: 0 });
    expect(installments(50, 9000, 3)).toEqual({ count: 1, valueCents: 50 });
    expect(installments(60000, 1000, 6)).toEqual({ count: 6, valueCents: 10000 });
    expect(installments(60000, 1000, 0)).toEqual({ count: 1, valueCents: 60000 });
  });
});

describe("pixPriceCents", () => {
  it("desconto percentual arredondado para baixo; 0% mantem o preco", () => {
    expect(pixPriceCents(10000, 5)).toBe(9500);
    expect(pixPriceCents(8990, 5)).toBe(8540); // 8540,5 -> 8540
    expect(pixPriceCents(8990, 0)).toBe(8990);
  });
});
