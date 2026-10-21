"use client";

import { useState, type FormEvent } from "react";

/** Captacao de e-mail no rodape da vitrine (consentimento explicito). */
export function SubscribeForm() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setState("busy");
    const res = await fetch("/api/subscribe", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: new FormData(form).get("email"), consent: true }),
    }).catch(() => null);
    if (res?.status === 201) { form.reset(); return setState("done"); }
    setState("error");
  }

  if (state === "done") return <p role="status">Pronto! Você vai receber nossas novidades.</p>;
  return (
    <form onSubmit={onSubmit}>
      <label>Receba novidades e ofertas <input name="email" type="email" required maxLength={254} placeholder="seu@email.com" /></label>
      <small>Ao se inscrever você concorda em receber e-mails desta loja e pode pedir a remoção a qualquer momento.</small>
      <button type="submit" disabled={state === "busy"}>Inscrever</button>
      {state === "error" && <p role="alert">Não foi possível inscrever. Confira o e-mail e tente de novo.</p>}
    </form>
  );
}
