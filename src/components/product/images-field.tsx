"use client";

import { useState } from "react";
import { api } from "./api";

export type Img = { url: string; color: string | null };

/** Upload (POST /api/admin/upload), cor opcional, ordem e remocao. No maximo 10. */
export function ImagesField({ images, onChange, colors }: { images: Img[]; onChange: (i: Img[]) => void; colors: string[] }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList | null) {
    setError("");
    let list = images;
    for (const file of Array.from(files ?? [])) {
      if (list.length >= 10) return setError("No máximo 10 imagens.");
      const fd = new FormData();
      fd.append("file", file);
      setBusy(true);
      const r = await api<{ url: string }>("/api/admin/upload", "POST", fd);
      setBusy(false);
      if (!r.ok) return setError(r.error);
      list = [...list, { url: r.data.url, color: null }];
      onChange(list);
    }
  }
  const move = (i: number, d: -1 | 1) => {
    const next = [...images];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };

  return (
    <div>
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexWrap: "wrap", gap: 12 }}>
        {images.map((im, i) => (
          <li key={im.url} style={{ border: "1px solid #ccc", padding: 6 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={im.url} alt={`Imagem ${i + 1}`} width={96} height={96} style={{ objectFit: "cover", display: "block" }} />
            <select aria-label="Cor da imagem" value={im.color ?? ""} onChange={(e) => onChange(images.map((x, j) => (j === i ? { ...x, color: e.target.value || null } : x)))}>
              <option value="">Todas as cores</option>
              {colors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div>
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Mover para a esquerda">←</button>
              <button type="button" disabled={i === images.length - 1} onClick={() => move(i, 1)} aria-label="Mover para a direita">→</button>
              <button type="button" onClick={() => onChange(images.filter((_, j) => j !== i))}>Remover</button>
            </div>
          </li>
        ))}
      </ul>
      <label>
        Enviar imagens (JPG, PNG, WEBP ou AVIF, até 5 MB){" "}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple disabled={busy || images.length >= 10} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
      </label>
      {busy && <p>Enviando…</p>}
      {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}
