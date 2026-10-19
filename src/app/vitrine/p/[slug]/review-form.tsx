"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const MESSAGES: Record<string, string> = {
  NOT_PURCHASER: "Só quem comprou este produto pode avaliar.",
  ALREADY_REVIEWED: "Você já avaliou este produto.",
  MUITAS_REQUISICOES: "Muitas tentativas. Tente mais tarde.",
};

export function ReviewForm({ productId }: { productId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const res = await fetch("/api/reviews", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId, rating: Number(fd.get("rating")), comment: String(fd.get("comment") ?? "") }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) return router.refresh();
    const json = (await res?.json().catch(() => ({}))) ?? {};
    setError(MESSAGES[json.error] ?? "Não foi possível enviar. Tente novamente.");
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 6, maxWidth: 420 }}>
      <label>Nota{" "}
        <select name="rating" defaultValue="5" required>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} {n === 1 ? "estrela" : "estrelas"}</option>)}
        </select>
      </label>
      <label>Comentário (opcional) <textarea name="comment" maxLength={1000} rows={3} /></label>
      <button type="submit" disabled={busy}>Enviar avaliação</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
