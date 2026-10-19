import { dbForStore } from "@/lib/db-store";
import { decrypt, encrypt } from "@/lib/crypto";
import { normalizeCep } from "./cep";

export type SettingsErrorCode =
  | "CEP_INVALID" | "PIX_DISCOUNT_INVALID" | "ACCOUNT_NOT_FOUND" | "ALREADY_MEMBER" | "MEMBER_NOT_FOUND"
  | "CANNOT_REMOVE_OWNER" | "CANNOT_REMOVE_SELF" | "DOMAIN_INVALID" | "DOMAIN_TAKEN" | "DOMAIN_NOT_FOUND"
  | "INVITE_NOT_FOUND" | "INVITE_INVALID";

/** Erro das telas de configuracao (configuracoes, credenciais, equipe, dominio); vira resposta em domainError. */
export class SettingsError extends Error {
  name = "SettingsError";
  constructor(readonly status: 400 | 404 | 409, readonly code: SettingsErrorCode, message: string = code) {
    super(message);
  }
}

/** Teto do desconto no Pix (%): evita erro de digitacao vendendo quase de graca. */
export const MAX_PIX_DISCOUNT = 50;
const DEFAULTS = { originCep: "37175000", pixDiscountPercent: "0" };

export async function getSettings(storeId: string): Promise<{ originCep: string; pixDiscountPercent: number }> {
  const rows = await dbForStore(storeId).storeSetting.findMany({ where: { key: { in: Object.keys(DEFAULTS) } } });
  const v = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  return { originCep: v.originCep, pixDiscountPercent: Number(v.pixDiscountPercent) };
}

const upsert = (db: Pick<ReturnType<typeof dbForStore>, "storeSetting">, storeId: string, key: string, value: string) =>
  db.storeSetting.upsert({ where: { storeId_key: { storeId, key } }, create: { storeId, key, value }, update: { value } });

export async function updateSettings(storeId: string, input: { originCep?: string; pixDiscountPercent?: number }): Promise<void> {
  const cep = input.originCep === undefined ? undefined : normalizeCep(input.originCep);
  if (cep === null) throw new SettingsError(400, "CEP_INVALID");
  const pix = input.pixDiscountPercent;
  if (pix !== undefined && !(Number.isInteger(pix) && pix >= 0 && pix <= MAX_PIX_DISCOUNT)) throw new SettingsError(400, "PIX_DISCOUNT_INVALID");
  await dbForStore(storeId).$transaction(async (tx) => {
    if (cep !== undefined) await upsert(tx, storeId, "originCep", cep);
    if (pix !== undefined) await upsert(tx, storeId, "pixDiscountPercent", String(pix));
  });
}

export const CREDENTIAL_FIELDS = ["mpAccessToken", "mpPublicKey", "mpWebhookSecret", "melhorEnvioToken"] as const;
export type CredentialField = (typeof CREDENTIAL_FIELDS)[number];
export type CredentialStatus = Record<CredentialField, { configured: boolean; last4: string | null }>;
const credKey = (f: CredentialField) => `cred.${f}`;

/** `skipBad`: linha que nao decifra (chave trocada, dado corrompido) vira "nao configurado" com aviso, em vez de erro. */
async function readCredentials(storeId: string, skipBad = false): Promise<Partial<Record<CredentialField, string>>> {
  const rows = await dbForStore(storeId).storeSetting.findMany({ where: { key: { in: CREDENTIAL_FIELDS.map(credKey) } } });
  const out: Partial<Record<CredentialField, string>> = {};
  for (const r of rows) {
    try {
      out[r.key.slice("cred.".length) as CredentialField] = decrypt(r.value);
    } catch (e) {
      if (!skipBad) throw e;
      console.warn(`[credenciais] loja ${storeId}: ${r.key} nao decifra; tratada como nao configurada`);
    }
  }
  return out;
}

/** Uso interno do servidor (pagamento/frete): valores decifrados (linha ilegivel = erro). Nunca devolver em rota. */
export const getStoreCredentials = (storeId: string) => readCredentials(storeId);

/** Unica visao de credenciais que sai para o cliente: configurado e os 4 ultimos (so se o segredo tiver 8+ caracteres). */
export async function getCredentialStatus(storeId: string): Promise<CredentialStatus> {
  const plain = await readCredentials(storeId, true);
  return Object.fromEntries(CREDENTIAL_FIELDS.map((f) => {
    const v = plain[f];
    return [f, { configured: v !== undefined, last4: v !== undefined && v.length >= 8 ? v.slice(-4) : null }];
  })) as CredentialStatus;
}

/** Valor vazio/so espacos = manter o atual; `clear` apaga o campo. */
export async function setCredentials(storeId: string, input: Partial<Record<CredentialField, string>>, clear: CredentialField[] = []): Promise<void> {
  await dbForStore(storeId).$transaction(async (tx) => {
    for (const f of CREDENTIAL_FIELDS) {
      const v = input[f]?.trim();
      if (clear.includes(f)) await tx.storeSetting.deleteMany({ where: { key: credKey(f) } });
      else if (v) await upsert(tx, storeId, credKey(f), encrypt(v));
    }
  });
}
