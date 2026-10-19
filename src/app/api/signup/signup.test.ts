import { describe, expect, it } from "vitest";
import { POST } from "./route";

const send = (ip: string, extra: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/signup", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": ip, ...extra }, body: "{}",
  }));

describe("POST /api/signup", () => {
  it("429 apos 5 tentativas por hora do mesmo IP; outro IP segue", async () => {
    const ip = `10.2.0.${Math.random().toString(36).slice(2, 8)}`;
    for (let i = 0; i < 5; i++) expect((await send(ip)).status).toBe(400);
    const res = await send(ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect((await send(`${ip}-b`)).status).toBe(400);
  });
  it("CSRF: origem cruzada ou Content-Type nao-JSON -> 403", async () => {
    const ip = `10.2.1.${Math.random().toString(36).slice(2, 8)}`;
    expect((await send(ip, { origin: "http://evil.example" })).status).toBe(403);
    expect((await send(ip, { "content-type": "text/plain" })).status).toBe(403);
  });
});
