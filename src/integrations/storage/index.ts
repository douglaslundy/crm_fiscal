import type { ImageStorage } from "./image";
import { LocalDiskStorage, uploadsRoot } from "./local-disk";
import { VercelBlobStorage } from "./vercel-blob";

export * from "./image";
export { LocalDiskStorage, VercelBlobStorage, uploadsRoot };

/** Blob da Vercel com BLOB_READ_WRITE_TOKEN; senao disco local: sempre fora de producao, e em producao so com STORAGE=local (VPS com volume em UPLOADS_DIR). */
export function getStorage(env: Record<string, string | undefined> = process.env): ImageStorage {
  if (env.BLOB_READ_WRITE_TOKEN) return new VercelBlobStorage(env.BLOB_READ_WRITE_TOKEN);
  if (env.NODE_ENV === "production" && env.STORAGE !== "local") throw new Error("BLOB_READ_WRITE_TOKEN ausente: upload de imagens indisponível em produção (ou defina STORAGE=local).");
  return new LocalDiskStorage();
}
