import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Credenciais das lojas (Mercado Pago, Melhor Envio). Payload: base64(iv[12] | tag[16] | ciphertext).
// Sem chave padrao em nenhum ambiente: chave ausente/invalida lanca erro (os testes definem uma em tests/setup-env.ts).
function key(): Buffer {
  const hex = process.env.CREDENTIALS_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("CREDENTIALS_KEY ausente ou invalida: use 64 caracteres hexadecimais (32 bytes).");
  return Buffer.from(hex, "hex");
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

/** Lanca erro se o payload foi adulterado ou cifrado com outra chave. */
export function decrypt(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  if (raw.length < 28) throw new Error("Payload cifrado invalido.");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
