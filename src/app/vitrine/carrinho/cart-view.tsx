"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CartIssue, PricedLine } from "@/domain/cart";
import { formatBRL } from "@/domain/money";
import { read, remove, replace, serverSnapshot, setQty, subscribe } from "@/lib/cart-store";

type Priced = { lines: PricedLine[]; subtotalCents: number; issues: CartIssue[] };

const NONE: Priced = { lines: [], subtotalCents: 0, issues: [] };
const issueText = (i: CartIssue) =>
  i.kind === "QTY_REDUCED" ? `Quantidade reduzida para ${i.available}` : i.kind === "OUT_OF_STOCK" ? "Esgotado" : "Indisponível";

/** Carrinho do navegador revalidado no servidor: o que o servidor devolve corrige o que esta guardado. */
export function CartView() {
  const stored = useSyncExternalStore(subscribe, read, serverSnapshot);
  const [priced, setPriced] = useState<Priced | null>(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(stored);

  useEffect(() => {
    if (stored.length === 0) return;
    const ctl = new AbortController();
    fetch("/api/cart/price", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines: stored }), signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Priced>) : Promise.reject(new Error(String(r.status)))))
      .then((p) => {
        setFailed(false);
        setPriced(p);
        // Corrige o guardado; so escreve se mudou (senao o efeito rodaria em laco).
        const fixed = p.lines.map((l) => ({ variantId: l.variantId, qty: l.qty }));
        if (JSON.stringify(fixed) !== key) replace(fixed);
      })
      .catch((e: Error) => { if (e.name !== "AbortError") setFailed(true); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` representa o conteudo de `stored`
  }, [key]);

  if (failed) return <p role="alert">Não foi possível atualizar o carrinho. Tente novamente.</p>;
  // Carrinho esvaziado pela correcao do servidor mantem os avisos; esvaziado pelo usuario, nao.
  const view = stored.length > 0 ? priced : priced && priced.lines.length === 0 && priced.issues.length > 0 ? priced : NONE;
  if (!view) return <p>Carregando…</p>;
  const names = new Map(view.lines.map((l) => [l.variantId, `${l.productName} (${l.color} / ${l.size})`]));
  const empty = view.lines.length === 0;
  return (
    <div>
      {view.issues.length > 0 && (
        <ul role="status" style={{ color: "#b45309", paddingLeft: 18 }}>
          {view.issues.map((i) => <li key={i.variantId}>{names.get(i.variantId) ?? "Um item do carrinho"}: {issueText(i)}</li>)}
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
                <button type="button" aria-label="Diminuir quantidade" onClick={() => setQty(l.variantId, l.qty - 1)}>−</button>
                <span style={{ margin: "0 8px" }}>{l.qty}</span>
                <button type="button" aria-label="Aumentar quantidade" onClick={() => setQty(l.variantId, l.qty + 1)}>+</button>
              </div>
              <div style={{ minWidth: 90, textAlign: "right" }}>{formatBRL(l.lineCents)}</div>
              <button type="button" onClick={() => remove(l.variantId)}>Remover</button>
            </li>
          ))}
        </ul>
      )}
      <p style={{ fontSize: 18 }}>Subtotal: <strong>{formatBRL(view.subtotalCents)}</strong></p>
      {empty
        ? <button type="button" disabled>Finalizar compra</button>
        : <Link href="/checkout" style={{ display: "inline-block", padding: "10px 16px", background: "#111", color: "#fff", textDecoration: "none" }}>Finalizar compra</Link>}
    </div>
  );
}
