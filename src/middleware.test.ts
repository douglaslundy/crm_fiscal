import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const call = (url: string, host: string, extra: Record<string, string> = {}) =>
  middleware(new NextRequest(url, { headers: { host, ...extra } }));
const run = (host: string, extra: Record<string, string> = {}) => call("http://x/", host, extra).headers;

describe("middleware", () => {
  it("encaminha host de loja normalizado", () => {
    process.env.PLATFORM_DOMAIN = "plataforma.test";
    expect(run("Demo.Plataforma.test:3000").get("x-middleware-request-x-store-host")).toBe("demo.plataforma.test");
  });
  it("host da plataforma nao vira loja e header forjado e descartado", () => {
    process.env.PLATFORM_DOMAIN = "plataforma.test";
    const h = run("www.plataforma.test", { "x-store-host": "outra.plataforma.test" });
    expect(h.get("x-middleware-request-x-store-host")).toBeNull();
    expect(h.get("x-middleware-override-headers")).not.toContain("x-store-host");
  });
  it("loja: caminho publico e reescrito para /vitrine (com query), mantendo o header da loja", () => {
    process.env.PLATFORM_DOMAIN = "plataforma.test";
    const h = call("http://demo.plataforma.test/c/camisetas?size=M", "demo.plataforma.test", { "x-store-host": "outra.plataforma.test" }).headers;
    expect(new URL(h.get("x-middleware-rewrite")!).pathname).toBe("/vitrine/c/camisetas");
    expect(new URL(h.get("x-middleware-rewrite")!).search).toBe("?size=M");
    expect(h.get("x-middleware-request-x-store-host")).toBe("demo.plataforma.test");
  });
  it("loja: /checkout e reescrito para /vitrine/checkout (com query); /checkout/x nao", () => {
    process.env.PLATFORM_DOMAIN = "plataforma.test";
    const h = call("http://demo.plataforma.test/checkout?pedido=abc", "demo.plataforma.test").headers;
    expect(new URL(h.get("x-middleware-rewrite")!).pathname).toBe("/vitrine/checkout");
    expect(new URL(h.get("x-middleware-rewrite")!).search).toBe("?pedido=abc");
    expect(h.get("x-middleware-request-x-store-host")).toBe("demo.plataforma.test");
    expect(call("http://demo.plataforma.test/checkout/x", "demo.plataforma.test").headers.get("x-middleware-rewrite")).toBeNull();
  });
  it("loja: /admin nao e reescrito; plataforma nunca e reescrita", () => {
    process.env.PLATFORM_DOMAIN = "plataforma.test";
    expect(call("http://demo.plataforma.test/admin", "demo.plataforma.test").headers.get("x-middleware-rewrite")).toBeNull();
    const h = call("http://plataforma.test/", "plataforma.test", { "x-store-host": "demo.plataforma.test" }).headers;
    expect(h.get("x-middleware-rewrite")).toBeNull();
    expect(h.get("x-middleware-request-x-store-host")).toBeNull();
  });
});
