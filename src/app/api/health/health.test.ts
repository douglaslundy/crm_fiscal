import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "./route";

afterAll(() => prisma.$disconnect());

describe("GET /api/health", () => {
  it("200 com o banco no ar", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });
  it("503 sem detalhes quando o banco falha", async () => {
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("senha do banco: x"));
    const r = await GET();
    spy.mockRestore();
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain("senha");
  });
});
