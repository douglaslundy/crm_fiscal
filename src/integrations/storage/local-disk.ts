import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IMAGE_TYPES, isOwnImageUrl, type ImageStorage, type ImageType } from "./image";

/** So desenvolvimento: grava em public/uploads/stores/<loja>/ (git-ignorado), servido pelo Next em /uploads/... */
export class LocalDiskStorage implements ImageStorage {
  constructor(private root = join(process.cwd(), "public", "uploads")) {}

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

  async remove(url: string) {
    const m = /^\/uploads\/stores\/([A-Za-z0-9_-]+)\//.exec(url);
    if (!m || !isOwnImageUrl(this, m[1], url)) return; // so arquivo nosso, nunca caminho arbitrario
    await unlink(join(this.root, url.slice("/uploads/".length))).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
