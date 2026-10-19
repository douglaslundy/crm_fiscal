import { dbForStore } from "@/lib/db-store";
import { MAX_VARIANTS } from "./variants";
import {
  ProductError, VariantCreate, VariantPatch, isFkError, uniqueToProductError, type Tx, type VariantCreateInput,
} from "./products";
import type { z } from "zod";

// Regra escolhida: desativar/apagar a ultima variacao ativa de produto ativo e recusado (400 LAST_ACTIVE_VARIANT);
// o lojista desativa o produto antes. Nada muda sozinho.
async function assertNotLastActive(tx: Tx, productId: string, variantId: string): Promise<void> {
  const p = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { active: true } });
  if (!p.active) return;
  if (!(await tx.variant.count({ where: { productId, active: true, id: { not: variantId } } }))) throw new ProductError("LAST_ACTIVE_VARIANT");
}

async function findVariant(tx: Tx, productId: string, variantId: string) {
  const v = await tx.variant.findFirst({ where: { id: variantId, productId } });
  if (!v) throw new ProductError("VARIANT_NOT_FOUND");
  return v;
}

/**
 * Imagens marcadas com `oldColor` passam a `newColor` (null = sem cor) quando nenhuma outra variacao do produto
 * continua com a cor antiga. `onlyActive`: na exclusao suave, variacao inativa nao segura a cor.
 */
async function syncImageColor(tx: Tx, productId: string, variantId: string, oldColor: string, newColor: string | null, onlyActive = false) {
  const still = await tx.variant.count({ where: { productId, color: oldColor, id: { not: variantId }, ...(onlyActive && { active: true }) } });
  if (!still) await tx.productImage.updateMany({ where: { productId, color: oldColor }, data: { color: newColor } });
}

// Todas sob a trava da loja: contagem/ultima-ativa nao se intercalam com outra edicao do mesmo produto.
const run = async <T>(storeId: string, fn: (tx: Tx) => Promise<T>): Promise<T> => {
  try {
    return await dbForStore(storeId).$transaction(fn, { lockStore: true });
  } catch (e) {
    throw uniqueToProductError(e);
  }
};

export async function addVariant(storeId: string, productId: string, input: VariantCreateInput) {
  const data = VariantCreate.parse(input);
  return run(storeId, async (tx) => {
    if (!(await tx.product.findUnique({ where: { id: productId }, select: { id: true } }))) throw new ProductError("PRODUCT_NOT_FOUND");
    if ((await tx.variant.count({ where: { productId } })) >= MAX_VARIANTS) throw new ProductError("TOO_MANY_VARIANTS");
    const same = await tx.variant.findMany({ where: { productId }, select: { color: true, size: true } });
    if (same.some((v) => v.color.toLowerCase() === data.color.toLowerCase() && v.size.toLowerCase() === data.size.toLowerCase())) throw new ProductError("VARIANT_EXISTS");
    return tx.variant.create({ data: { ...data, storeId, productId } });
  });
}

export async function updateVariant(storeId: string, productId: string, variantId: string, input: z.input<typeof VariantPatch>) {
  const data = VariantPatch.parse(input);
  return run(storeId, async (tx) => {
    const v = await findVariant(tx, productId, variantId);
    if (data.active === false && v.active) await assertNotLastActive(tx, productId, variantId);
    const color = data.color ?? v.color;
    const size = data.size ?? v.size;
    if (data.color !== undefined || data.size !== undefined) {
      const others = await tx.variant.findMany({ where: { productId, id: { not: variantId } }, select: { color: true, size: true } });
      if (others.some((o) => o.color.toLowerCase() === color.toLowerCase() && o.size.toLowerCase() === size.toLowerCase())) throw new ProductError("VARIANT_EXISTS");
    }
    const updated = await tx.variant.update({ where: { id: variantId }, data });
    if (updated.color !== v.color) await syncImageColor(tx, productId, variantId, v.color, updated.color);
    return updated;
  });
}

/** Variacao com historico de pedidos nao sai (FK NoAction): exclusao vira desativacao (softDeleted). */
export async function deleteVariant(storeId: string, productId: string, variantId: string): Promise<{ ok: true; softDeleted: boolean }> {
  const soft = async (tx: Tx, v: { active: boolean; color: string }) => {
    if (v.active) {
      await assertNotLastActive(tx, productId, variantId);
      await tx.variant.update({ where: { id: variantId }, data: { active: false } });
    }
    await syncImageColor(tx, productId, variantId, v.color, null, true);
    return { ok: true as const, softDeleted: true };
  };
  try {
    return await run(storeId, async (tx) => {
      const v = await findVariant(tx, productId, variantId);
      if (await tx.orderItem.count({ where: { variantId } })) return soft(tx, v);
      if (v.active) await assertNotLastActive(tx, productId, variantId);
      await tx.variant.delete({ where: { id: variantId } });
      await syncImageColor(tx, productId, variantId, v.color, null);
      return { ok: true as const, softDeleted: false };
    });
  } catch (e) {
    // Corrida: pedido criado entre a contagem e o delete -> mesma saida da exclusao suave.
    if (!isFkError(e)) throw e;
    return run(storeId, async (tx) => soft(tx, await findVariant(tx, productId, variantId)));
  }
}
