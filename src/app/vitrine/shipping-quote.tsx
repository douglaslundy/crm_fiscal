"use client";

import { useEffect, useRef, useState } from "react";
import { formatBRL } from "@/domain/money";

type Option = { service: string; priceCents: number; days: number };
export const SHIPPING_ERRORS: Record<string, string> = {
  CEP_INVALIDO: "CEP inválido.",
  FRETE_INDISPONIVEL: "Frete indisponível no momento. Tente novamente.",
  FRETE_NAO_CONFIGURADO: "Esta loja ainda não configurou o frete.",
  CARRINHO_VAZIO: "Nenhum item disponível para cotar.",
  STORE_UNAVAILABLE: "Loja indisponível no momento.",
  TOTAL_MUITO_ALTO: "O valor do carrinho passa do limite. Divida em pedidos menores.",
};

/** Cotacao de frete por CEP para as linhas dadas. Quem usa passa `key` com os itens: itens novos remontam e descartam a cotacao antiga. */
export function ShippingQuote({ lines }: { lines: { variantId: string; qty: number }[] }) {
  const [cep, setCep] = useState("");
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null); // so a ultima consulta vale
  useEffect(() => () => ctl.current?.abort(), []);

  async function calc(e: React.FormEvent) {
    e.preventDefault();
    ctl.current?.abort();
    const mine = (ctl.current = new AbortController());
    setBusy(true); setError(null); setOptions(null);
    try {
      const r = await fetch("/api/shipping/quote", { signal: mine.signal, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cep, lines }) });
      const data = await r.json().catch(() => null);
      if (mine.signal.aborted) return;
      if (r.ok) setOptions(data.options);
      else setError(SHIPPING_ERRORS[data?.error] ?? "Não foi possível calcular o frete.");
    } catch {
      if (!mine.signal.aborted) setError("Não foi possível calcular o frete.");
    } finally {
      if (!mine.signal.aborted) setBusy(false);
    }
  }

  return (
    <form onSubmit={calc} style={{ margin: "16px 0" }}>
      <label>Calcular frete{" "}
        <input value={cep} onChange={(e) => setCep(e.target.value)} inputMode="numeric" placeholder="00000-000" maxLength={9} style={{ width: 110 }} />
      </label>{" "}
      <button type="submit" disabled={busy || lines.length === 0 || cep.trim() === ""}>{busy ? "Calculando…" : "Calcular frete"}</button>
      {error && <p role="alert">{error}</p>}
      {options && (options.length === 0
        ? <p role="status">Nenhuma opção de entrega para este CEP.</p>
        : <ul role="status" style={{ listStyle: "none", padding: 0 }}>
            {options.map((o, i) => <li key={`${i}-${o.service}`}>{o.service}: <strong>{formatBRL(o.priceCents)}</strong> — {o.days} {o.days === 1 ? "dia útil" : "dias úteis"}</li>)}
          </ul>)}
    </form>
  );
}
