import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AVIF, JPEG, PNG, WEBP } from "../../../tests/fake-storage";
import { LocalDiskStorage, VercelBlobStorage, getStorage, isOwnImageUrl, matchesSignature } from ".";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("matchesSignature", () => {
  it("aceita cada formato com o cabecalho certo", () => {
    expect(matchesSignature(PNG, "image/png")).toBe(true);
    expect(matchesSignature(JPEG, "image/jpeg")).toBe(true);
    expect(matchesSignature(WEBP, "image/webp")).toBe(true);
    expect(matchesSignature(AVIF, "image/avif")).toBe(true);
  });
  it("recusa tipo declarado diferente do conteudo, arquivo curto e HTML/SVG", () => {
    expect(matchesSignature(PNG, "image/jpeg")).toBe(false);
    expect(matchesSignature(JPEG, "image/png")).toBe(false);
    expect(matchesSignature(PNG.slice(0, 4), "image/png")).toBe(false);
    expect(matchesSignature(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/png")).toBe(false);
    expect(matchesSignature(new TextEncoder().encode("RIFF0000WAVEfmt "), "image/webp")).toBe(false);
  });
});

describe("getStorage", () => {
  it("sem token em producao falha; sem token fora de producao usa disco local; com token usa Blob", () => {
    expect(() => getStorage({ NODE_ENV: "production" })).toThrow(/BLOB_READ_WRITE_TOKEN/);
    expect(getStorage({ NODE_ENV: "development" })).toBeInstanceOf(LocalDiskStorage);
    const blob = getStorage({ NODE_ENV: "production", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_AbC123_segredo" });
    expect(blob).toBeInstanceOf(VercelBlobStorage);
    expect(blob.urlPrefix("loja1")).toBe("https://abc123.public.blob.vercel-storage.com/stores/loja1/");
  });
});

describe("LocalDiskStorage", () => {
  it("grava em stores/<loja>/<id aleatorio>.<ext> e remove so URL propria", async () => {
    const root = mkdtempSync(join(tmpdir(), "up-"));
    dirs.push(root);
    const s = new LocalDiskStorage(root);
    const { url } = await s.put({ storeId: "loja1", bytes: PNG, contentType: "image/png" });
    expect(url).toMatch(/^\/uploads\/stores\/loja1\/[0-9a-f-]{36}\.png$/);
    const file = join(root, url.replace("/uploads/", ""));
    expect(readFileSync(file)).toEqual(Buffer.from(PNG));
    expect(isOwnImageUrl(s, "loja1", url)).toBe(true);
    expect(isOwnImageUrl(s, "loja2", url)).toBe(false);
    await s.remove("/uploads/stores/loja1/../../../etc.png");
    await s.remove(url);
    expect(existsSync(file)).toBe(false);
    await expect(s.remove(url)).resolves.toBeUndefined(); // ja removido
  });
});

describe("isOwnImageUrl", () => {
  const s = new LocalDiskStorage("/x");
  it.each([
    ["/uploads/stores/L/abc-123.png", true],
    ["/uploads/stores/L/abc.webp", true],
    ["/uploads/stores/L2/abc.png", false],
    ["/uploads/stores/L/../M/abc.png", false],
    ["/uploads/stores/L/sub/abc.png", false],
    ["/uploads/stores/L/abc.svg", false],
    ["/uploads/stores/L/abc.png?x=1", false],
    ["https://evil.example/uploads/stores/L/abc.png", false],
    ["javascript:alert(1)", false],
  ])("%s -> %s", (url, ok) => {
    expect(isOwnImageUrl(s, "L", url)).toBe(ok);
  });
});

describe("LocalDiskStorage.usage", () => {
  it("soma os bytes da loja e e 0 sem pasta", async () => {
    const root = mkdtempSync(join(tmpdir(), "usage-"));
    dirs.push(root);
    const s = new LocalDiskStorage(root);
    expect(await s.usage("lojaA")).toBe(0);
    await s.put({ storeId: "lojaA", bytes: PNG, contentType: "image/png" });
    await s.put({ storeId: "lojaA", bytes: JPEG, contentType: "image/jpeg" });
    await s.put({ storeId: "lojaB", bytes: WEBP, contentType: "image/webp" });
    expect(await s.usage("lojaA")).toBe(PNG.byteLength + JPEG.byteLength);
  });
});
