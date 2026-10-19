"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/** Aparencia da vitrine: cor principal e logo (enviado ao armazenamento da loja). */
export function ThemeForm({ primaryColor, logoUrl }: { primaryColor: string | null; logoUrl: string | null }) {
  const router = useRouter();
  const [color, setColor] = useState(primaryColor ?? "#111111");
  const [useDefaultColor, setUseDefaultColor] = useState(primaryColor === null);
  const [logo, setLogo] = useState(logoUrl);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg("");
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) return setLogo((await res.json()).url);
    setMsg("Não foi possível enviar a imagem (JPEG, PNG, WebP ou AVIF até 5 MB).");
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/admin/theme", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ primaryColor: useDefaultColor ? null : color, logoUrl: logo }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) { setMsg("Salvo."); return router.refresh(); }
    setMsg("Não foi possível salvar.");
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 8, maxWidth: 420, margin: "8px 0" }}>
      <label>Cor principal <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setUseDefaultColor(false); }} /></label>
      <label><input type="checkbox" checked={useDefaultColor} onChange={(e) => setUseDefaultColor(e.target.checked)} /> Usar a cor padrão</label>
      <label>Logo <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e) => upload(e.target.files?.[0])} /></label>
      {logo && (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element -- previa do logo enviado */}
          <img src={logo} alt="Logo atual" style={{ maxHeight: 48 }} />{" "}
          <button type="button" onClick={() => setLogo(null)}>Remover logo</button>
        </div>
      )}
      <button type="submit" disabled={busy}>Salvar aparência</button>
      {msg && <p role="status">{msg}</p>}
    </form>
  );
}
