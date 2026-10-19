import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { STORE_HOST_HEADER } from "@/lib/host";
import { JPEG, MemoryStorage, PNG, WEBP } from "../../../../../tests/fake-storage";

const storage = new MemoryStorage();
vi.mock("@/auth", async (orig) => ({ ...(await orig<typeof import("@/auth")>()), getSession: vi.fn() }));
vi.mock("@/integrations/storage", async (orig) => ({ ...(await orig<typeof import("@/integrations/storage")>()), getStorage: () => storage }));
const auth = await import("@/auth");
const { POST } = await import("./route");
const { MAX_IMAGE_BYTES } = await import("@/integrations/storage");

let tag: string;
let planId: string;
let storeId: string;
let accountId: string;

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.create({ data: { name: `T10u-${tag}`, priceCents: 1, staffLimit: 3, customDomain: false, advancedMetrics: false, csvExport: false } })).id;
  accountId = (await prisma.account.create({ data: { name: "s", email: `up-${tag}@t.local`, passwordHash: "x" } })).id;
  storeId = (await prisma.store.create({ data: { slug: `t10u-${tag}`, name: "u", planId, status: "ACTIVE", members: { create: [{ accountId, role: "STAFF" }] } } })).id;
  vi.mocked(auth.getSession).mockResolvedValue({ user: { id: accountId, kind: "account" }, expires: "2099-01-01" });
  storage.files.clear();
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.account.deleteMany({ where: { id: accountId } });
  await prisma.plan.deleteMany({ where: { id: planId } });
});
afterAll(() => prisma.$disconnect());

const form = (parts: Record<string, Blob | string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(parts)) fd.append(k, v, ...(v instanceof Blob ? ["foto do cliente ../../x.php"] : []) as []);
  return fd;
};
const send = (body: BodyInit) =>
  POST(new Request("http://localhost/api/admin/upload", { method: "POST", headers: { origin: "http://localhost", [STORE_HOST_HEADER]: `t10u-${tag}.localhost` }, body }));
const result = async (r: Promise<Response>) => { const x = await r; return [x.status, (await x.json()).error]; };

describe("POST /api/admin/upload", () => {
  it("PNG, JPEG e WEBP validos -> {url} na pasta da loja, nome aleatorio (nunca o do cliente)", async () => {
    for (const [bytes, type, ext] of [[PNG, "image/png", "png"], [JPEG, "image/jpeg", "jpg"], [WEBP, "image/webp", "webp"]] as const) {
      const res = await send(form({ file: new Blob([bytes], { type }) }));
      expect(res.status).toBe(201);
      const { url } = await res.json();
      expect(url).toMatch(new RegExp(`^https://fake\\.test/stores/${storeId}/[A-Za-z0-9-]+\\.${ext}$`));
      expect(url).not.toMatch(/cliente|php/);
      expect(storage.files.get(url)?.bytes).toEqual(bytes);
    }
  });

  it("sem arquivo, campo errado, arquivo vazio ou corpo invalido -> 400 FILE_REQUIRED", async () => {
    expect(await result(send(form({ outro: new Blob([PNG], { type: "image/png" }) })))).toEqual([400, "FILE_REQUIRED"]);
    expect(await result(send(form({ file: "texto" })))).toEqual([400, "FILE_REQUIRED"]);
    expect(await result(send(form({ file: new Blob([], { type: "image/png" }) })))).toEqual([400, "FILE_REQUIRED"]);
    const bad = new Request("http://localhost/api/admin/upload", {
      method: "POST", body: "lixo",
      headers: { origin: "http://localhost", "content-type": "multipart/form-data; boundary=zzz", [STORE_HOST_HEADER]: `t10u-${tag}.localhost` },
    });
    expect(await result(POST(bad))).toEqual([400, "FILE_REQUIRED"]);
  });

  it("acima de 5 MB -> 413 FILE_TOO_LARGE (contado na leitura, sem confiar em Content-Length)", async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    expect(await result(send(form({ file: new Blob([big], { type: "image/png" }) })))).toEqual([413, "FILE_TOO_LARGE"]);
    // Content-Length mentiroso nao ajuda: o corpo e contado enquanto chega
    const huge = new Request("http://localhost/api/admin/upload", {
      method: "POST", body: new Blob([new Uint8Array(MAX_IMAGE_BYTES * 2)]),
      headers: { origin: "http://localhost", "content-type": "multipart/form-data; boundary=zzz", "content-length": "10", [STORE_HOST_HEADER]: `t10u-${tag}.localhost` },
    });
    expect(await result(POST(huge))).toEqual([413, "FILE_TOO_LARGE"]);
    const exact = new Uint8Array(MAX_IMAGE_BYTES);
    exact.set(PNG);
    expect((await send(form({ file: new Blob([exact], { type: "image/png" }) }))).status).toBe(201);
    expect(storage.files.size).toBe(1);
  });

  it.each([
    ["SVG", "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "image/svg+xml"],
    ["HTML", "<html><script>alert(1)</script></html>", "text/html"],
    ["GIF", "GIF89a....", "image/gif"],
    ["sem tipo", "x", ""],
  ])("%s -> 415 UNSUPPORTED_TYPE", async (_l, content, type) => {
    expect(await result(send(form({ file: new Blob([content], { type }) })))).toEqual([415, "UNSUPPORTED_TYPE"]);
    expect(storage.files.size).toBe(0);
  });

  it("conteudo que nao bate com o tipo declarado -> 400 FILE_SIGNATURE_MISMATCH", async () => {
    expect(await result(send(form({ file: new Blob(["<svg/>"], { type: "image/png" }) })))).toEqual([400, "FILE_SIGNATURE_MISMATCH"]);
    expect(await result(send(form({ file: new Blob([PNG], { type: "image/jpeg" }) })))).toEqual([400, "FILE_SIGNATURE_MISMATCH"]);
    expect(storage.files.size).toBe(0);
  });
});
