export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" } as const;
export type ImageType = keyof typeof IMAGE_TYPES;
export const isImageType = (t: string): t is ImageType => Object.hasOwn(IMAGE_TYPES, t);

export interface ImageStorage {
  /** Grava em stores/<storeId>/<id aleatorio>.<ext> e devolve a URL publica. */
  put(input: { storeId: string; bytes: Uint8Array; contentType: ImageType }): Promise<{ url: string }>;
  remove(url: string): Promise<void>;
  /** Prefixo de toda URL emitida para a loja (termina em `stores/<storeId>/`). */
  urlPrefix(storeId: string): string;
  /** Bytes ja gravados para a loja; ausente quando o provedor nao mede (Blob: cobranca fica la). */
  usage?(storeId: string): Promise<number>;
}

/** URL emitida por este armazenamento para ESTA loja: prefixo exato + um nome de arquivo nosso (sem subpasta, query ou ..). */
export function isOwnImageUrl(storage: ImageStorage, storeId: string, url: string): boolean {
  const prefix = storage.urlPrefix(storeId);
  return url.startsWith(prefix) && /^[A-Za-z0-9-]{1,64}\.(jpg|png|webp|avif)$/.test(url.slice(prefix.length));
}

const at = (b: Uint8Array, offset: number, sig: number[] | string) =>
  [...(typeof sig === "string" ? Buffer.from(sig, "latin1") : sig)].every((x, i) => b[offset + i] === x);

/** Assinatura (magic bytes) do arquivo confere com o tipo declarado. */
export function matchesSignature(b: Uint8Array, type: ImageType): boolean {
  switch (type) {
    case "image/jpeg": return at(b, 0, [0xff, 0xd8, 0xff]);
    case "image/png": return at(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp": return at(b, 0, "RIFF") && at(b, 8, "WEBP");
    case "image/avif": {
      // caixa ftyp: tamanho(4) "ftyp" marca(4) versao(4) marcas compativeis(4 cada)
      if (!at(b, 4, "ftyp")) return false;
      const end = Math.min(b.length, (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]);
      for (let i = 8; i + 4 <= end; i += i === 8 ? 8 : 4) if (at(b, i, "avif") || at(b, i, "avis")) return true;
      return false;
    }
  }
}
