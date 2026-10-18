import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const run = (host: string, extra: Record<string, string> = {}) =>
  middleware(new NextRequest("http://x/", { headers: { host, ...extra } })).headers;

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
});
