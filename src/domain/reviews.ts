import { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbForStore } from "@/lib/db-store";

export type ReviewErrorCode = "NOT_PURCHASER" | "ALREADY_REVIEWED" | "PRODUCT_NOT_FOUND" | "REVIEW_NOT_FOUND";

export class ReviewError extends Error {
  name = "ReviewError";
  constructor(readonly status: 403 | 404 | 409, readonly code: ReviewErrorCode) {
    super(code);
  }
}

export const REVIEW_PAGE = 20;
const PAID = ["PAID", "SHIPPED", "DELIVERED"] as const;

export const ReviewBody = z.object({
  productId: z.string().min(1).max(64),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).default(""),
});
export const ReviewPatch = z.object({ hidden: z.boolean() });

/** So quem tem pedido pago com o produto (a variacao precisa ainda existir para ligar o item ao produto). */
export async function hasPurchased(storeId: string, customerId: string, productId: string): Promise<boolean> {
  return !!(await dbForStore(storeId).orderItem.findFirst({
    where: { variant: { productId }, order: { customerId, status: { in: [...PAID] } } }, select: { id: true },
  }));
}

export async function createReview(storeId: string, customerId: string, input: z.infer<typeof ReviewBody>) {
  const db = dbForStore(storeId);
  if (!(await db.product.findFirst({ where: { id: input.productId, active: true }, select: { id: true } }))) throw new ReviewError(404, "PRODUCT_NOT_FOUND");
  if (!(await hasPurchased(storeId, customerId, input.productId))) throw new ReviewError(403, "NOT_PURCHASER");
  try {
    return await db.review.create({ data: { storeId, customerId, ...input }, select: { id: true, rating: true, comment: true, createdAt: true } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ReviewError(409, "ALREADY_REVIEWED");
    throw e;
  }
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** Vitrine: media, total e as mais recentes (visiveis). So o primeiro nome do cliente sai. */
export async function getProductReviews(storeId: string, productId: string) {
  const db = dbForStore(storeId);
  const where = { productId, hidden: false };
  const [agg, rows] = await Promise.all([
    db.review.aggregate({ where, _avg: { rating: true }, _count: { _all: true } }),
    db.review.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: REVIEW_PAGE,
      select: { id: true, rating: true, comment: true, createdAt: true, customer: { select: { name: true } } },
    }),
  ]);
  return {
    count: agg._count._all,
    average: agg._avg.rating === null ? null : Math.round(agg._avg.rating * 10) / 10,
    items: rows.map(({ customer, ...r }) => ({ ...r, author: firstName(customer.name) })),
  };
}

/** Estado para o cliente logado: pode avaliar (comprou e ainda nao avaliou)? */
export async function reviewEligibility(storeId: string, customerId: string, productId: string): Promise<"CAN_REVIEW" | "ALREADY_REVIEWED" | "NOT_PURCHASER"> {
  if (await dbForStore(storeId).review.findFirst({ where: { productId, customerId }, select: { id: true } })) return "ALREADY_REVIEWED";
  return (await hasPurchased(storeId, customerId, productId)) ? "CAN_REVIEW" : "NOT_PURCHASER";
}

export async function listReviewsAdmin(storeId: string, page = 1) {
  const db = dbForStore(storeId);
  const [items, total] = await Promise.all([
    db.review.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * 50, take: 50,
      select: { id: true, rating: true, comment: true, hidden: true, createdAt: true, product: { select: { name: true } }, customer: { select: { name: true } } },
    }),
    db.review.count(),
  ]);
  return { items, total, page, pageSize: 50 };
}

export async function setReviewHidden(storeId: string, id: string, hidden: boolean): Promise<void> {
  const { count } = await dbForStore(storeId).review.updateMany({ where: { id }, data: { hidden } });
  if (count === 0) throw new ReviewError(404, "REVIEW_NOT_FOUND");
}

export async function deleteReview(storeId: string, id: string): Promise<void> {
  const { count } = await dbForStore(storeId).review.deleteMany({ where: { id } });
  if (count === 0) throw new ReviewError(404, "REVIEW_NOT_FOUND");
}
