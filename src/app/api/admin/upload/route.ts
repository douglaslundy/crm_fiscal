import { NextResponse } from "next/server";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { err } from "@/lib/master-api";
import { MAX_IMAGE_BYTES, getStorage, isImageType, matchesSignature } from "@/integrations/storage";

/** Teto de armazenamento por loja (disco local): STORE_UPLOAD_QUOTA_MB, padrao 500. */
const uploadQuotaBytes = () => (Number(process.env.STORE_UPLOAD_QUOTA_MB) || 500) * 1024 * 1024;

const MULTIPART_SLACK = 64 * 1024; // cabecalhos multipart em volta do arquivo

/** Le o corpo contando bytes enquanto chega; passou do teto -> null (nao confia em Content-Length). */
async function readCapped(req: Request, max: number): Promise<Buffer<ArrayBuffer> | null> {
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Upload de imagem da loja (multipart, campo `file`): jpeg/png/webp/avif ate 5 MB, assinatura conferida. 413 se maior. */
export async function POST(req: Request) {
  const ctx = await denyUnlessStoreMember(req, { write: true, multipart: true });
  if (denied(ctx)) return ctx;
  const raw = await readCapped(req, MAX_IMAGE_BYTES + MULTIPART_SLACK);
  if (!raw) return err(413, "FILE_TOO_LARGE");
  const form = await new Response(raw, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) return err(400, "FILE_REQUIRED");
  if (file.size > MAX_IMAGE_BYTES) return err(413, "FILE_TOO_LARGE");
  if (!isImageType(file.type)) return err(415, "UNSUPPORTED_TYPE");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesSignature(bytes, file.type)) return err(400, "FILE_SIGNATURE_MISMATCH");
  const quota = uploadQuotaBytes();
  const storage = getStorage();
  if (storage.usage && (await storage.usage(ctx.store.id)) + bytes.byteLength > quota) return err(413, "QUOTA_EXCEEDED");
  // Nome do cliente nunca entra no caminho: o armazenamento gera um id aleatorio.
  const { url } = await storage.put({ storeId: ctx.store.id, bytes, contentType: file.type });
  return NextResponse.json({ url }, { status: 201 });
}
