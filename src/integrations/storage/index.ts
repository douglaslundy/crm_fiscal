import type { ImageStorage } from "./image";
import { LocalDiskStorage } from "./local-disk";
import { VercelBlobStorage } from "./vercel-blob";

export * from "./image";
export { LocalDiskStorage, VercelBlobStorage };

/** Blob da Vercel com BLOB_READ_WRITE_TOKEN; sem token, disco local (public/uploads) so fora de producao. */
export function getStorage(env: Record<string, string | undefined> = process.env): ImageStorage {
  if (env.BLOB_READ_WRITE_TOKEN) return new VercelBlobStorage(env.BLOB_READ_WRITE_TOKEN);
  if (env.NODE_ENV === "production") throw new Error("BLOB_READ_WRITE_TOKEN ausente: upload de imagens indisponível em produção.");
  return new LocalDiskStorage();
}
