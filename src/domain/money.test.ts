import { describe, expect, it } from "vitest";
import { formatBRL } from "@/domain/money";

describe("formatBRL", () => {
  it("formata centavos em reais", () => {
    const s = formatBRL(8990);
    expect(s).toContain("R$");
    expect(s).toContain("89,90");
  });
});
