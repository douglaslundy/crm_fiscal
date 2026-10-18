import { expect, it } from "vitest";
import { normalizeCep } from "./cep";

it("normalizeCep", () => {
  expect(normalizeCep("37175-000")).toBe("37175000");
  expect(normalizeCep(" 37175000 ")).toBe("37175000");
  expect(normalizeCep("37.175-000")).toBe("37175000");
  for (const bad of ["123", "", "371750000", "37175-00a", "abcde-fgh"]) expect(normalizeCep(bad), bad).toBeNull();
});
