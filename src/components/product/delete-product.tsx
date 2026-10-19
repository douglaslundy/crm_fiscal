"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

export function DeleteProduct({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  async function onClick() {
    if (!window.confirm(`Excluir o produto "${name}"? Esta ação não pode ser desfeita.`)) return;
    const r = await api(`/api/admin/products/${id}`, "DELETE");
    if (r.ok) router.push("/admin/produtos");
    else setError(r.error);
  }
  return (
    <p>
      <button type="button" onClick={() => void onClick()}>Excluir produto</button>
      {error && <span role="alert" style={{ color: "crimson", marginLeft: 8 }}>{error}</span>}
    </p>
  );
}
