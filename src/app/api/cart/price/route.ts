import { NextResponse } from "next/server";
import { z } from "zod";
import { priceCart, type VariantRow } from "@/domain/cart";
import { isStoreBlocked } from "@/domain/subscription";
import { assertSameOriginJson } from "@/lib/csrf";
import { dbForStore } from "@/lib/db-store";
import { getCurrentStore } from "@/lib/tenant";

// Zod remove chaves desconhecidas: preco enviado pelo navegador nunca chega a priceCart.
const Body = z.object({ lines: z.array(z.object({ variantId: z.string().max(64), qty: z.number().finite() })).max(50) });

/** Publico (sem login): revalida o carrinho do navegador com preco/estoque do banco, so da loja do host. */
export async function POST(req: Request) {
  const csrf = assertSameOriginJson(req);
  if (csrf) return csrf;
  const store = await getCurrentStore();
  if (isStoreBlocked(store)) return NextResponse.json({ error: "STORE_UNAVAILABLE" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  const { lines } = parsed.data;
  const rows = await dbForStore(store.id).variant.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.variantId))] }, product: { active: true } },
    select: {
      id: true, productId: true, color: true, size: true, sku: true, priceCents: true, stock: true, active: true,
      product: { select: { name: true, images: { orderBy: { position: "asc" }, select: { url: true, color: true } } } },
    },
  });
  const variants: VariantRow[] = rows.map(({ product, ...v }) => ({
    ...v,
    productName: product.name,
    imageUrl: (product.images.find((i) => i.color === v.color) ?? product.images[0])?.url ?? null,
  }));
  return NextResponse.json(priceCart(lines, variants));
}
