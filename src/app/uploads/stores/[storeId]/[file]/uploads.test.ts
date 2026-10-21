import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "./route";

let dir: string;
const call = (storeId: string, file: string) => GET(new Request("http://x/"), { params: Promise.resolve({ storeId, file }) });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "uploads-"));
  process.env.UPLOADS_DIR = dir;
  await mkdir(join(dir, "stores", "loja1"), { recursive: true });
  await writeFile(join(dir, "stores", "loja1", "abc-123.png"), Buffer.from([1, 2, 3]));
  await writeFile(join(dir, "secret.png"), "x");
});
afterAll(async () => {
  delete process.env.UPLOADS_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("GET /uploads/stores/:loja/:arquivo", () => {
  it("serve a imagem com tipo e nosniff", async () => {
    const r = await call("loja1", "abc-123.png");
    expect([r.status, r.headers.get("content-type"), r.headers.get("x-content-type-options")]).toEqual([200, "image/png", "nosniff"]);
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([1, 2, 3]);
  });
  it("404: inexistente, extensao desconhecida, travessia de caminho", async () => {
    for (const [s, f] of [["loja1", "nao-existe.png"], ["loja1", "abc-123.svg"], ["loja1", "..%2F..%2Fsecret.png"], ["loja1", "../../secret.png"], ["..", "secret.png"], ["a/b", "abc-123.png"]]) {
      expect((await call(s, f)).status, `${s}/${f}`).toBe(404);
    }
  });
});
