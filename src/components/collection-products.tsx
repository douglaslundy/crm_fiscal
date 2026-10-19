"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/** Marca os produtos da colecao e salva o conjunto inteiro. */
export function CollectionProducts({ collectionId, products, selected }: { collectionId: string; products: { id: string; name: string }[]; selected: string[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const productIds = new FormData(e.currentTarget).getAll("productId").map(String);
    const res = await fetch(`/api/admin/collections/${collectionId}/products`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ productIds }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) { setMsg("Salvo."); return router.refresh(); }
    setMsg("Não foi possível salvar.");
  }

  const chosen = new Set(selected);
  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 4, margin: "8px 0" }}>
      {products.length === 0 && <p>Cadastre produtos primeiro.</p>}
      {products.map((p) => (
        <label key={p.id}><input type="checkbox" name="productId" value={p.id} defaultChecked={chosen.has(p.id)} /> {p.name}</label>
      ))}
      <button type="submit" disabled={busy}>Salvar produtos</button>
      {msg && <p role="status">{msg}</p>}
    </form>
  );
}
