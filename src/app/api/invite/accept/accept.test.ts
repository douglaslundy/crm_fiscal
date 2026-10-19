import { describe, expect, it } from "vitest";
import { POST } from "./route";

const send = (ip: string, body: unknown = {}, extra: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/invite/accept", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": ip, ...extra }, body: JSON.stringify(body),
  }));
const ipOf = () => `10.3.0.${Math.random().toString(36).slice(2, 8)}`;

describe("POST /api/invite/accept", () => {
  it("corpo invalido 400; token desconhecido 404 INVITE_INVALID", async () => {
    expect((await send(ipOf())).status).toBe(400);
    const r = await send(ipOf(), { token: "x".repeat(43), name: "N", password: "senha-longa-1" });
    expect([r.status, (await r.json()).error]).toEqual([404, "INVITE_INVALID"]);
  });
  it("429 apos 10 tentativas por hora do mesmo IP", async () => {
    const ip = ipOf();
    for (let i = 0; i < 10; i++) expect((await send(ip)).status).toBe(400);
    expect((await send(ip)).status).toBe(429);
  });
  it("CSRF: origem cruzada 403; host de loja 404", async () => {
    expect((await send(ipOf(), {}, { origin: "http://evil.example" })).status).toBe(403);
    expect((await send(ipOf(), {}, { "x-store-host": "demo.plataforma.test" })).status).toBe(404);
  });
});
