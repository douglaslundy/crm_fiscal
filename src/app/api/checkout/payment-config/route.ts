import { NextResponse } from "next/server";
import { getStoreCredentials } from "@/domain/storeSettings";
import { denyUnlessCustomer } from "@/lib/customer-api";

/**
 * Config do Card Payment Brick: chave PUBLICA da loja (publica por desenho). Access token e segredo do webhook nunca saem.
 * fake=true so fora de producao e sem access token (formulario de teste no lugar do Brick).
 */
export async function GET(req: Request) {
  const ctx = await denyUnlessCustomer(req);
  if (ctx instanceof NextResponse) return ctx;
  const { mpAccessToken, mpPublicKey } = await getStoreCredentials(ctx.store.id);
  const fake = !mpAccessToken && process.env.NODE_ENV !== "production";
  return NextResponse.json({ publicKey: mpAccessToken && mpPublicKey ? mpPublicKey : null, fake });
}
