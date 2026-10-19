import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Cron (vercel.json): exige `Authorization: Bearer ${CRON_SECRET}`; sem CRON_SECRET recusa tudo. null = autorizado. */
export function denyUnlessCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  // hash antes de comparar: tamanho igual e comparacao em tempo constante
  if (!secret || !timingSafeEqual(digest(auth), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  return null;
}
