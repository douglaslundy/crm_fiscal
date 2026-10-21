import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { uploadsRoot } from "@/integrations/storage";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif" };

/** Serve imagens do disco local (STORAGE=local). Nome gerado por nos: so [A-Za-z0-9-] + extensao conhecida, sem subpasta. */
export async function GET(_req: Request, { params }: { params: Promise<{ storeId: string; file: string }> }) {
  const { storeId, file } = await params;
  const m = /^[A-Za-z0-9-]{1,64}\.(jpg|png|webp|avif)$/.exec(file);
  if (!m || !/^[A-Za-z0-9_-]+$/.test(storeId)) return new Response("Not found", { status: 404 });
  const bytes = await readFile(join(uploadsRoot(), "stores", storeId, file)).catch(() => null);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": TYPES[m[1]], "x-content-type-options": "nosniff", "cache-control": "public, max-age=31536000, immutable" },
  });
}
