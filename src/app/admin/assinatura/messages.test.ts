import { expect, it } from "vitest";
import { errorMessage } from "./messages";

it("errorMessage: so chaves da lista; prototipo e desconhecido viram mensagem generica", () => {
  expect(errorMessage("PLAN_NOT_AVAILABLE")).toBe("Plano indisponível.");
  expect(errorMessage("SUSPENDED_BY_MASTER")).toMatch(/suspensa pela plataforma/);
  for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty", "x"]) {
    expect(errorMessage(code)).toBe("Não foi possível concluir.");
  }
});
