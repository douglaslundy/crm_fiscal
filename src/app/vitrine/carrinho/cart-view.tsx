"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { mergeNotices, type CartIssue, type PricedLine } from "@/domain/cart";
import { formatBRL } from "@/domain/money";
import { read, remove, replace, serverSnapshot, setQty, subscribe } from "@/lib/cart-store";
import { ShippingQuote } from "../shipping-quote";

type Priced = { lines: PricedLine[]; subtotalCents: number; issues: CartIssue[] };

const NONE: Priced = { lines: [], subtotalCents: 0, issues: [] };
const issueText = (i: CartIssue) =>
  i.kind === "QTY_REDUCED" ? `Quantidade reduzida para ${i.available}` : i.kind === "OUT_OF_STOCK" ? "Esgotado" : "Indisponível";

/** Carrinho do navegador revalidado no servidor: o que o servidor devolve corrige o que esta guardado. */
export function CartView() {
  const stored = useSyncExternalStore(subscribe, read, serverSnapshot);
  const [priced, setPriced] = useState<Priced | null>(null);
  const [notices, setNotices] = useState<CartIssue[]>([]);
  const [failure, setFailure] = useState<"UNAVAILABLE" | "ERROR" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [names, setNames] = useState<Record<string, string>>({}); // nomes ja vistos, para avisar sobre linhas que o servidor removeu
  const key = JSON.stringify(stored);

  useEffect(() => {
    if (stored.length === 0) return;
    const ctl = new AbortController();
    fetch("/api/cart/price", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines: stored }), signal: ctl.signal })
      .then(async (r) => {
        if (r.status === 403 && (await r.json().catch(() => null))?.error === "STORE_UNAVAILABLE") return setFailure("UNAVAILABLE");
        if (!r.ok) return setFailure("ERROR");
        const p = (await r.json()) as Priced;
        setFailure(null);
        setPriced(p);
        setNames((prev) => ({ ...prev, ...Object.fromEntries(p.lines.map((l) => [l.variantId, `${l.productName} (${l.color} / ${l.size})`])) }));
        setNotices((prev) => mergeNotices(prev, p.issues));
        // Corrige o guardado; so escreve se mudou (senao o efeito rodaria em laco).
        const fixed = p.lines.map((l) => ({ variantId: l.variantId, qty: l.qty }));
        if (JSON.stringify(fixed) !== key) replace(fixed);
      })
      .catch((e: Error) => { if (e.name !== "AbortError") setFailure("ERROR"); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` representa o conteudo de `stored`
  }, [key, attempt]);

  // Acao do usuario: os avisos antigos deixam de valer.
  const act = (fn: () => boolean) => () => { setNotices([]); fn(); };

  if (failure) {
    return (
      <div role="alert">
        <p>{failure === "UNAVAILABLE" ? "Loja indisponível no momento." : "Não foi possível atualizar o carrinho."}</p>
        {failure === "ERROR" && <button type="button" onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button>}
      </div>
    );
  }
  const view = stored.length > 0 ? priced : NONE;
  if (!view) return <p>Carregando…</p>;
  const empty = view.lines.length === 0;
  return (
    <div>
      {notices.length > 0 && (
        <ul role="status" style={{ color: "#b45309", paddingLeft: 18 }}>
          {notices.map((i) => <li key={i.variantId}>{names[i.variantId] ?? "Um item do carrinho"}: {issueText(i)}</li>)}
        </ul>
      )}
      {empty ? <p>Seu carrinho está vazio. <Link href="/">Continuar comprando</Link></p> : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {view.lines.map((l) => (
            <li key={l.variantId} style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #eee", flexWrap: "wrap" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {l.imageUrl && <img src={l.imageUrl} alt="" width={64} height={64} style={{ objectFit: "cover" }} />}
              <div style={{ flex: "1 1 160px" }}>
                <strong>{l.productName}</strong>
                <div>{l.color} / {l.size}</div>
                <div>{formatBRL(l.unitCents)}</div>
              </div>
              <div>
                <button type="button" aria-label="Diminuir quantidade" onClick={act(() => setQty(l.variantId, l.qty - 1))}>−</button>
                <span style={{ margin: "0 8px" }}>{l.qty}</span>
                <button type="button" aria-label="Aumentar quantidade" onClick={act(() => setQty(l.variantId, l.qty + 1))}>+</button>
              </div>
              <div style={{ minWidth: 90, textAlign: "right" }}>{formatBRL(l.lineCents)}</div>
              <button type="button" onClick={act(() => remove(l.variantId))}>Remover</button>
            </li>
          ))}
        </ul>
      )}
      {!empty && <ShippingQuote key={JSON.stringify(view.lines.map((l) => [l.variantId, l.qty]))} lines={view.lines.map((l) => ({ variantId: l.variantId, qty: l.qty }))} />}
      <p style={{ fontSize: 18 }}>Subtotal: <strong>{formatBRL(view.subtotalCents)}</strong></p>
      {empty
        ? <button type="button" disabled>Finalizar compra</button>
        : <Link href="/checkout" style={{ display: "inline-block", padding: "10px 16px", background: "var(--primary, #111)", color: "var(--on-primary, #fff)", textDecoration: "none" }}>Finalizar compra</Link>}
    </div>
  );
}
