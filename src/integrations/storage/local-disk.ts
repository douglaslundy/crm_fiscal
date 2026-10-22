import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IMAGE_TYPES, isOwnImageUrl, type ImageStorage, type ImageType } from "./image";

/** Pasta dos uploads: UPLOADS_DIR (volume em producao) ou public/uploads (dev, git-ignorado). */
export const uploadsRoot = () => process.env.UPLOADS_DIR ?? join(process.cwd(), "public", "uploads");

/** Grava em <uploadsRoot>/stores/<loja>/; servido em /uploads/... pela rota src/app/uploads (o `next start` nao serve arquivos novos de public/). */
export class LocalDiskStorage implements ImageStorage {
  constructor(private root = uploadsRoot()) {}

  urlPrefix(storeId: string) {
    return `/uploads/stores/${storeId}/`;
  }

  async put({ storeId, bytes, contentType }: { storeId: string; bytes: Uint8Array; contentType: ImageType }) {
    const name = `${randomUUID()}.${IMAGE_TYPES[contentType]}`;
    const dir = join(this.root, "stores", storeId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), bytes);
    return { url: `${this.urlPrefix(storeId)}${name}` };
  }

  async usage(storeId: string) {
    const dir = join(this.root, "stores", storeId);
    const names = await readdir(dir).catch((e) => {
      if (e.code !== "ENOENT") throw e;
      return [] as string[];
    });
    let total = 0;
    for (const n of names) total += (await stat(join(dir, n))).size;
    return total;
  }

  async remove(url: string) {
    const m = /^\/uploads\/stores\/([A-Za-z0-9_-]+)\//.exec(url);
    if (!m || !isOwnImageUrl(this, m[1], url)) return; // so arquivo nosso, nunca caminho arbitrario
    await unlink(join(this.root, url.slice("/uploads/".length))).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
