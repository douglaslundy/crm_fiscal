"use client";

import { useState, type FormEvent } from "react";

const MESSAGES: Record<string, string> = {
  INVITE_INVALID: "Convite inválido ou expirado. Peça um novo ao dono da loja.",
  STAFF_LIMIT: "A loja atingiu o limite de colaboradores do plano.",
};

export function AcceptInviteForm({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/invite/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...Object.fromEntries(new FormData(e.currentTarget)), token }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) return setDone(true);
    const json = (await res?.json().catch(() => ({}))) ?? {};
    setError(MESSAGES[json.error] ?? "Confira os dados: nome e senha com pelo menos 8 caracteres.");
  }

  if (done) return <p role="status">Conta criada! <a href="/entrar">Entrar no painel</a></p>;
  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 6, maxWidth: 420 }}>
      <label>Seu nome <input name="name" autoComplete="name" required /></label>
      <label>Senha <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required /></label>
      <button type="submit" disabled={busy}>Criar conta e entrar</button>
      {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}
    </form>
  );
}
