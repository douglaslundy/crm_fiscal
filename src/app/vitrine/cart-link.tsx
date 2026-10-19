"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { read, serverSnapshot, subscribe } from "@/lib/cart-store";

/** Link do carrinho no cabecalho, com a quantidade de itens (so no navegador). */
export function CartLink() {
  const lines = useSyncExternalStore(subscribe, read, serverSnapshot);
  const n = lines.reduce((s, l) => s + l.qty, 0);
  return <Link href="/carrinho" aria-label={`Carrinho, ${n} ${n === 1 ? "item" : "itens"}`}>Carrinho{n > 0 ? ` (${n})` : ""}</Link>;
}
