import { describe, expect, it } from "vitest";
import { assertSameOriginJson } from "./csrf";

const req = (method: string, headers: Record<string, string>, body?: string) =>
  new Request("http://app.localhost:3000/api/master/x", { method, headers: { host: "app.localhost:3000", ...headers }, body });
const JSON_H = { "content-type": "application/json" };

describe("assertSameOriginJson", () => {
  it.each([
    ["JSON com Origin proprio", "POST", { origin: "http://app.localhost:3000", ...JSON_H }, "{}", true],
    ["POST sem corpo com Origin proprio", "POST", { origin: "http://app.localhost:3000" }, undefined, true],
    ["JSON com charset", "PATCH", { origin: "http://app.localhost:3000", "content-type": "application/json; charset=utf-8" }, "{}", true],
    ["dominio da plataforma configurado", "POST", { origin: "http://localhost", ...JSON_H }, "{}", true],
    ["sem Origin, Sec-Fetch-Site same-origin", "POST", { "sec-fetch-site": "same-origin", ...JSON_H }, "{}", true],
    ["sem Origin, Sec-Fetch-Site none", "DELETE", { "sec-fetch-site": "none" }, undefined, true],
    ["Origin estrangeiro", "POST", { origin: "https://evil.example", ...JSON_H }, "{}", false],
    ["Origin de subdominio de loja irma", "POST", { origin: "http://loja.localhost:3000", ...JSON_H }, "{}", false],
    ["Origin 'null'", "POST", { origin: "null", ...JSON_H }, "{}", false],
    ["sem Origin, cross-site", "POST", { "sec-fetch-site": "cross-site", ...JSON_H }, "{}", false],
    ["sem Origin, same-site (subdominio)", "POST", { "sec-fetch-site": "same-site", ...JSON_H }, "{}", false],
    ["sem Origin e sem Sec-Fetch-Site", "POST", JSON_H, "{}", false],
    ["text/plain com corpo", "POST", { origin: "http://app.localhost:3000", "content-type": "text/plain" }, "{}", false],
    ["form com corpo", "POST", { origin: "http://app.localhost:3000", "content-type": "application/x-www-form-urlencoded" }, "a=1", false],
    ["corpo sem Content-Type", "POST", { origin: "http://app.localhost:3000" }, "{}", false],
    ["POST sem corpo, Origin estrangeiro", "POST", { origin: "https://evil.example" }, undefined, false],
  ] as const)("%s", (_l, method, headers, body, ok) => {
    const r = assertSameOriginJson(req(method, headers, body));
    expect(r === null).toBe(ok);
    if (!ok) expect(r!.status).toBe(403);
  });

  it("GET/HEAD/OPTIONS nao sao afetados", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(assertSameOriginJson(req(m, { origin: "https://evil.example" }))).toBeNull();
  });

  it.each([
    ["multipart com Origin proprio", { origin: "http://app.localhost:3000", "content-type": "multipart/form-data; boundary=x" }, true],
    ["multipart sem Origin, same-origin", { "sec-fetch-site": "same-origin", "content-type": "multipart/form-data; boundary=x" }, true],
    ["multipart com Origin estrangeiro", { origin: "https://evil.example", "content-type": "multipart/form-data; boundary=x" }, false],
    ["multipart sem Origin nem Sec-Fetch-Site", { "content-type": "multipart/form-data; boundary=x" }, false],
    ["JSON na rota multipart", { origin: "http://app.localhost:3000", ...JSON_H }, false],
    ["text/plain na rota multipart", { origin: "http://app.localhost:3000", "content-type": "text/plain" }, false],
    ["form urlencoded na rota multipart", { origin: "http://app.localhost:3000", "content-type": "application/x-www-form-urlencoded" }, false],
  ] as const)("allowMultipart: %s", (_l, headers, ok) => {
    const r = assertSameOriginJson(req("POST", headers, "x"), { allowMultipart: true });
    expect(r === null).toBe(ok);
    if (!ok) expect(r!.status).toBe(403);
  });

  it("sem a opcao, multipart continua recusado", () => {
    expect(assertSameOriginJson(req("POST", { origin: "http://app.localhost:3000", "content-type": "multipart/form-data; boundary=x" }, "x"))?.status).toBe(403);
  });
});
