"use client";

import { useState, type FormEvent } from "react";

/** Pede o link de redefinicao; a resposta e sempre a mesma (nao revela se o e-mail tem conta). */
export function ForgotForm() {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("busy");
    const res = await fetch("/api/password/forgot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: new FormData(e.currentTarget).get("email") }),
    }).catch(() => null);
    setState(res?.ok ? "sent" : "error");
  }

  if (state === "sent") return <p role="status">Se existir uma conta com esse e-mail, enviamos o link para redefinir a senha.</p>;
  return (
    <form onSubmit={onSubmit}>
      <label>
        E-mail <input name="email" type="email" autoComplete="email" required />
      </label>
      {state === "error" && <p role="alert">Não foi possível enviar. Confira o e-mail e tente de novo em instantes.</p>}
      <button type="submit" disabled={state === "busy"}>{state === "busy" ? "Enviando..." : "Enviar link"}</button>
    </form>
  );
}
