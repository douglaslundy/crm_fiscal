import { NextResponse } from "next/server";
import { CsvNotAllowedError, exportOrdersCsv, parseDays } from "@/domain/metrics";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { err } from "@/lib/master-api";

export async function GET(req: Request) {
  const ctx = await denyUnlessStoreMember(req);
  if (denied(ctx)) return ctx;
  const days = parseDays(new URL(req.url).searchParams.get("days"));
  try {
    const csv = await exportOrdersCsv(ctx.store.id, days);
    return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="pedidos-${days}d.csv"` } });
  } catch (e) {
    if (e instanceof CsvNotAllowedError) return err(403, "PLANO_NAO_PERMITE", { code: "PLANO_NAO_PERMITE" });
    throw e;
  }
}
