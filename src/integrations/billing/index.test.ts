import { afterEach, describe, expect, it, vi } from "vitest";
import { getBilling } from "./index";
import { FakeBilling } from "./fakeBilling";
import { MercadoPagoBilling } from "./mercadopagoBilling";

afterEach(() => vi.unstubAllEnvs());

describe("getBilling", () => {
  it("sem token: FakeBilling fora de producao; em producao falha", () => {
    vi.stubEnv("BILLING_MP_ACCESS_TOKEN", "");
    expect(getBilling()).toBeInstanceOf(FakeBilling);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getBilling()).toThrow(/BILLING_MP_ACCESS_TOKEN/);
  });

  it("token sem BILLING_WEBHOOK_SECRET falha alto; com os dois, adaptador real", () => {
    vi.stubEnv("BILLING_MP_ACCESS_TOKEN", "tok");
    vi.stubEnv("BILLING_WEBHOOK_SECRET", "");
    expect(() => getBilling()).toThrow(/BILLING_WEBHOOK_SECRET/);
    vi.stubEnv("BILLING_WEBHOOK_SECRET", "seg");
    expect(getBilling()).toBeInstanceOf(MercadoPagoBilling);
  });
});
