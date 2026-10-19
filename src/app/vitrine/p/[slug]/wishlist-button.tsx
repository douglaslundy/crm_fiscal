"use client";

import Link from "next/link";
import { useState } from "react";

/** Coracao de favoritar. Sem login (initial === null) vira link para entrar e voltar ao produto. */
export function WishlistButton({ productId, slug, initial }: { productId: string; slug: string; initial: boolean | null }) {
  const [on, setOn] = useState(initial ?? false);
  const [busy, setBusy] = useState(false);
  if (initial === null) return <Link href={`/loja-entrar?next=${encodeURIComponent(`/p/${slug}`)}`}>♡ Favoritar (entrar)</Link>;

  async function toggle() {
    setBusy(true);
    const next = !on;
    const res = await fetch("/api/wishlist", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productId, on: next }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) setOn(next);
  }
  return <button type="button" onClick={toggle} disabled={busy} aria-pressed={on}>{on ? "♥ Nos favoritos" : "♡ Favoritar"}</button>;
}
