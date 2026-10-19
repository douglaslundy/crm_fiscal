import { afterEach, describe, expect, it, vi } from "vitest";
import { platformDomain } from "./host";

afterEach(() => vi.unstubAllEnvs());

describe("platformDomain", () => {
  it("usa PLATFORM_DOMAIN; sem ele: localhost fora de producao, erro em producao", () => {
    vi.stubEnv("PLATFORM_DOMAIN", "lojas.com.br");
    expect(platformDomain()).toBe("lojas.com.br");
    vi.stubEnv("PLATFORM_DOMAIN", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(platformDomain()).toBe("localhost");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => platformDomain()).toThrow(/PLATFORM_DOMAIN/);
  });
});
