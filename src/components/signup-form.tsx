"use client";

import { useState, type FormEvent } from "react";

export type PlanOption = { id: string; label: string; details: string };

const MESSAGES: Record<string, string> = {
  EMAIL_EXISTS: "Este e-mail já possui cadastro. Entre com sua conta.",
  SLUG_TAKEN: "Este endereço já está em uso. Escolha outro.",
  SLUG_INVALID: "Endereço inválido ou reservado. Use letras minúsculas, números e hífens (até 40).",
  PLAN_NOT_FOUND: "Plano indisponível. Escolha outro.",
};

export function SignupForm({ plans }: { plans: PlanOption[] }) {
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ storeUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
    });
    setBusy(false);
    const json = await res.json().catch(() => ({}));
    if (res.status === 201) return setDone(json);
    setError(MESSAGES[json.error] ?? "Confira os dados: e-mail válido, senha com pelo menos 8 caracteres e nome da loja com 2 a 60 caracteres.");
  }

  if (done)
    return (
      <p role="status">
        Loja criada! Sua loja: <a href={done.storeUrl}>{done.storeUrl}</a>. <a href="/entrar">Entrar no painel</a>
      </p>
    );

  return (
    <form onSubmit={onSubmit}>
      <fieldset>
        <legend>Plano</legend>
        {plans.map((p, i) => (
          <label key={p.id}>
            <input type="radio" name="planId" value={p.id} defaultChecked={i === 0} required /> {p.label} <small>{p.details}</small>
          </label>
        ))}
      </fieldset>
      <label>
        Seu nome <input name="ownerName" autoComplete="name" required />
      </label>
      <label>
        E-mail <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Senha <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
      </label>
      <label>
        Nome da loja <input name="storeName" minLength={2} maxLength={60} required />
      </label>
      <label>
        Endereço (opcional) <input name="slug" maxLength={40} pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?" placeholder="minha-loja" />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Criando..." : "Começar 14 dias grátis"}</button>
    </form>
  );
}
