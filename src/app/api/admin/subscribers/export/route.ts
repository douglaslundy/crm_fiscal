import { NextResponse } from "next/server";
import { exportSubscribersCsv } from "@/domain/subscribers";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";

export async function GET(req: Request) {
  const ctx = await denyUnlessStoreMember(req);
  if (denied(ctx)) return ctx;
  const csv = await exportSubscribersCsv(ctx.store.id);
  return new NextResponse(csv, { headers: { "cache-control": "no-store", "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="inscritos.csv"' } });
}
