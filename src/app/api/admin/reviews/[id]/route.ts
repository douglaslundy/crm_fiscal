import { NextResponse } from "next/server";
import { ReviewPatch, deleteReview, setReviewHidden } from "@/domain/reviews";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, parseBody } from "@/lib/master-api";

type Ctx = { params: Promise<{ id: string }> };

/** Oculta ou volta a mostrar a avaliacao na vitrine. */
export async function PATCH(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, ReviewPatch);
  if ("res" in body) return body.res;
  try {
    await setReviewHidden(ctx.store.id, (await params).id, body.data.hidden);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  try {
    await deleteReview(ctx.store.id, (await params).id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
