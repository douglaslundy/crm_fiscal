import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { evaluateStoreLifecycle } from "@/domain/subscription";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Cron horario (vercel.json). Exige `Authorization: Bearer ${CRON_SECRET}`; sem CRON_SECRET recusa tudo. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  // hash antes de comparar: tamanho igual e comparacao em tempo constante
  if (!secret || !timingSafeEqual(digest(auth), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  return NextResponse.json(await evaluateStoreLifecycle(new Date()));
}
