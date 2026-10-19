import { afterEach, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

const KEY = process.env.CREDENTIALS_KEY;
afterEach(() => { process.env.CREDENTIALS_KEY = KEY; });

describe("crypto (AES-256-GCM)", () => {
  it("decrypt(encrypt(x)) === x, inclusive acentos e vazio", () => {
    for (const x of ["APP_USR-123-segredo", "çãé ✓", ""]) expect(decrypt(encrypt(x))).toBe(x);
  });
  it("dois encrypt do mesmo texto diferem (IV aleatorio) e nao contem o texto", () => {
    const a = encrypt("segredo-igual");
    expect(a).not.toBe(encrypt("segredo-igual"));
    expect(Buffer.from(a, "base64").toString("latin1")).not.toContain("segredo-igual");
  });
  it("payload adulterado lanca erro", () => {
    const raw = Buffer.from(encrypt("segredo"), "base64");
    for (const i of [0, 12, 28, raw.length - 1]) {
      const bad = Buffer.from(raw);
      bad[i] ^= 1;
      expect(() => decrypt(bad.toString("base64"))).toThrow();
    }
    expect(() => decrypt("curto")).toThrow();
  });
  it("chave ausente ou invalida lanca erro claro (sem chave padrao)", () => {
    for (const k of [undefined, "", "abc", "z".repeat(64)]) {
      if (k === undefined) delete process.env.CREDENTIALS_KEY; else process.env.CREDENTIALS_KEY = k;
      expect(() => encrypt("x")).toThrow(/CREDENTIALS_KEY/);
    }
  });
  it("outra chave nao decifra", () => {
    const p = encrypt("segredo");
    process.env.CREDENTIALS_KEY = "ab".repeat(32);
    expect(() => decrypt(p)).toThrow();
  });
});
