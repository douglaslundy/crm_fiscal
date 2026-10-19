import type { ImageStorage } from "@/integrations/storage";

/** Armazenamento em memoria para testes (injetado com vi.mock em getStorage). */
export class MemoryStorage implements ImageStorage {
  files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  removed: string[] = [];
  private n = 0;
  urlPrefix(storeId: string) {
    return `https://fake.test/stores/${storeId}/`;
  }
  async put({ storeId, bytes, contentType }: { storeId: string; bytes: Uint8Array; contentType: string }) {
    const url = `${this.urlPrefix(storeId)}fake${++this.n}-${Math.random().toString(36).slice(2, 10)}.${contentType.split("/")[1].replace("jpeg", "jpg")}`;
    this.files.set(url, { bytes, contentType });
    return { url };
  }
  async remove(url: string) {
    this.removed.push(url);
    this.files.delete(url);
  }
}

// Menores arquivos validos o bastante para a checagem de assinatura (cabecalho real de cada formato).
export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
export const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
export const WEBP = Uint8Array.from([...Buffer.from("RIFF"), 4, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
export const AVIF = Uint8Array.from([0, 0, 0, 24, ...Buffer.from("ftypavif"), 0, 0, 0, 0, ...Buffer.from("mif1miaf")]);
