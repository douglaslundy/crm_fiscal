import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("remove acentos e normaliza", () => {
    expect(slugify("Minha Loja Ótima")).toBe("minha-loja-otima");
    expect(slugify("  Calça  Jeans!! ")).toBe("calca-jeans");
    expect(slugify("---")).toBe("");
  });
});
