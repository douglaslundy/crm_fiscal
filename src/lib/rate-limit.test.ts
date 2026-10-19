import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("bloqueia apos o limite, informa Retry-After e reabre na janela seguinte", () => {
    let t = 0;
    const r = createRateLimiter({ limit: 2, windowMs: 60000, now: () => t });
    expect(r.check("a").ok).toBe(true);
    expect(r.check("a").ok).toBe(true);
    t = 10000;
    expect(r.check("a")).toEqual({ ok: false, retryAfterSec: 50 });
    expect(r.check("b").ok).toBe(true);
    t = 60000;
    expect(r.check("a").ok).toBe(true);
  });
  it("mapa limitado: descarta a chave mais antiga", () => {
    const r = createRateLimiter({ limit: 1, windowMs: 60000, maxKeys: 2 });
    r.check("a"); r.check("b"); r.check("c");
    expect(r.check("a").ok).toBe(true); // "a" foi descartada, comeca do zero
  });
});

describe("clientIp", () => {
  it("usa o 1o salto do x-forwarded-for, depois x-real-ip, depois unknown", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
