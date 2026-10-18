import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import { IMAGE_TYPES, type ImageStorage, type ImageType } from "./image";

export class VercelBlobStorage implements ImageStorage {
  private host: string;
  constructor(private token: string) {
    // Token vercel_blob_rw_<idDoStore>_<segredo>: o host publico do store e <id minusculo>.public.blob.vercel-storage.com
    const blobStoreId = token.split("_")[3];
    if (!blobStoreId) throw new Error("BLOB_READ_WRITE_TOKEN em formato inesperado.");
    this.host = `${blobStoreId.toLowerCase()}.public.blob.vercel-storage.com`;
  }

  urlPrefix(storeId: string) {
    return `https://${this.host}/stores/${storeId}/`;
  }

  async put({ storeId, bytes, contentType }: { storeId: string; bytes: Uint8Array; contentType: ImageType }) {
    const { url } = await put(`stores/${storeId}/${randomUUID()}.${IMAGE_TYPES[contentType]}`, Buffer.from(bytes), {
      access: "public", contentType, token: this.token, addRandomSuffix: false,
    });
    return { url };
  }

  async remove(url: string) {
    await del(url, { token: this.token });
  }
}
