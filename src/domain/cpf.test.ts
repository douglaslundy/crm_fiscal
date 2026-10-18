import { describe, expect, it } from "vitest";
import { isValidCpf } from "./cpf";

describe("isValidCpf", () => {
  it("valida digitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
  });
  it("rejeita repetidos e tamanho errado", () => {
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
    expect(isValidCpf("")).toBe(false);
  });
});
