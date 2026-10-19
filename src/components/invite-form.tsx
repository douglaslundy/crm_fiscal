"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const MESSAGES: Record<string, string> = {
  ALREADY_MEMBER: "Este usuário já faz parte da equipe.",
  PLAN_LIMIT: "Limite de colaboradores do plano atingido.",
};

/** Convida por e-mail: conta existente entra direto; e-mail novo recebe um link (mostrado uma unica vez) para o dono enviar. */
export function InviteForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    setLink("");
    const res = await fetch("/api/admin/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: new FormData(form).get("email") }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) {
      const json = await res.json();
      if (json.inviteUrl) setLink(json.inviteUrl);
      form.reset();
      return router.refresh();
    }
    const json = (await res?.json().catch(() => ({}))) ?? {};
    setError(MESSAGES[json.error] ?? "Não foi possível convidar. Confira o e-mail.");
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 6, maxWidth: 420, margin: "8px 0" }}>
      <label>E-mail <input name="email" type="email" required /></label>
      <button type="submit" disabled={busy}>Convidar</button>
      {link && <p role="status">Envie este link ao convidado (vale 7 dias e só aparece agora): <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ width: "100%" }} /></p>}
      {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}
    </form>
  );
}
