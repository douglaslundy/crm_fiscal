"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CartIssue, PricedLine } from "@/domain/cart";
import { formatBRL } from "@/domain/money";
import { clear, read, replace, serverSnapshot, subscribe } from "@/lib/cart-store";
import { SHIPPING_ERRORS } from "../shipping-quote";
import { AddressForm, addressLabel, type Address } from "./address-form";

type Priced = { lines: PricedLine[]; subtotalCents: number; issues: CartIssue[] };
type Option = { service: string; priceCents: number; days: number };
const COUPON_ERRORS: Record<string, string> = {
  COUPON_INVALID: "Cupom inválido ou expirado.",
  COUPON_EXHAUSTED: "Este cupom esgotou.",
  COUPON_MIN_SUBTOTAL: "O subtotal não atinge o mínimo deste cupom.",
  COUPON_ALREADY_USED: "Você já usou este cupom.",
};
const ORDER_ERRORS: Record<string, string> = {
  ...SHIPPING_ERRORS,
  CARRINHO_ALTERADO: "Seu carrinho mudou (preço, estoque ou disponibilidade). Confira os itens e tente de novo.",
  SEM_ESTOQUE: "Um item acabou de esgotar. Confira o carrinho e tente de novo.",
  FRETE_INVALIDO: "A opção de frete mudou. Escolha o frete novamente.",
  ENDERECO_INVALIDO: "Endereço inválido. Escolha outro endereço.",
  ITEM_FORA_DOS_LIMITES: "Um item passa dos limites de envio dos Correios.",
  MUITAS_REQUISICOES: "Muitas tentativas. Aguarde um minuto.",
  ...COUPON_ERRORS,
};
const issueText = (i: CartIssue) =>
  i.kind === "QTY_REDUCED" ? `quantidade reduzida para ${i.available}` : i.kind === "OUT_OF_STOCK" ? "esgotado" : "indisponível";
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Checkout do cliente logado. Valores mostrados sao so informativos: o servidor reprecifica e recota ao criar o pedido. */
export function CheckoutView({ initialAddresses }: { initialAddresses: Address[] }) {
  const router = useRouter();
  const stored = useSyncExternalStore(subscribe, read, serverSnapshot);
  const key = JSON.stringify(stored);
  const [priced, setPriced] = useState<Priced | null>(null);
  const [issues, setIssues] = useState<CartIssue[]>([]);
  const [addresses, setAddresses] = useState(initialAddresses);
  const [addressId, setAddressId] = useState(initialAddresses[0]?.id ?? "");
  const [quote, setQuote] = useState<{ for: string; options: Option[] } | null>(null);
  const [service, setService] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [done, setDone] = useState(false);
  const [serverTotal, setServerTotal] = useState<number | null>(null); // total do servidor que o cliente ainda precisa confirmar
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discountCents: number; cart: string } | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const attempt = useRef<{ cart: string; id: string } | null>(null);

  // Reprecifica o carrinho; a correcao do servidor regrava o carrinho guardado.
  useEffect(() => {
    if (stored.length === 0) return;
    let live = true;
    post("/api/cart/price", { lines: stored }).then(async (r) => {
      if (!live) return;
      if (!r.ok) return setError("Não foi possível carregar o carrinho.");
      const p = (await r.json()) as Priced;
      setPriced(p);
      if (p.issues.length > 0) setIssues(p.issues);
      const fixed = p.lines.map((l) => ({ variantId: l.variantId, qty: l.qty }));
      if (JSON.stringify(fixed) !== key) replace(fixed);
    }).catch(() => live && setError("Não foi possível carregar o carrinho."));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` representa o conteudo de `stored`
  }, [key, refresh]);

  // Cota o frete para o endereco escolhido e os itens atuais.
  // Cotacao vale so para o pedido de cotacao atual (endereco + itens); trocar qualquer um volta a "Calculando".
  const cep = addresses.find((a) => a.id === addressId)?.cep;
  const quoteFor = `${cep}|${key}|${refresh}`;
  const options = quote?.for === quoteFor ? quote.options : null;
  const shipping = options?.find((o) => o.service === service) ?? options?.[0];
  useEffect(() => {
    if (!cep || stored.length === 0) return;
    let live = true;
    post("/api/shipping/quote", { cep, lines: stored }).then(async (r) => {
      const data = await r.json().catch(() => null);
      if (!live) return;
      if (r.ok) setQuote({ for: quoteFor, options: data.options });
      else setError(SHIPPING_ERRORS[data?.error] ?? "Não foi possível calcular o frete.");
    }).catch(() => live && setError("Não foi possível calcular o frete."));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` representa o conteudo de `stored`
  }, [quoteFor]);

  // desconto vale so para o carrinho em que foi simulado; mudou o carrinho, aplique de novo
  const discount = coupon?.cart === key ? coupon.discountCents : 0;
  async function applyCoupon() {
    setCouponMsg(null);
    const r = await post("/api/checkout/coupon", { code: couponInput, lines: stored }).catch(() => null);
    const data = await r?.json().catch(() => null);
    if (r?.ok) { setServerTotal(null); setCoupon({ code: data.code, discountCents: data.discountCents, cart: key }); return; }
    setCoupon(null);
    setCouponMsg(COUPON_ERRORS[data?.error] ?? "Não foi possível aplicar o cupom.");
  }

  async function placeOrder() {
    setBusy(true); setError(null);
    try {
      const expectedTotalCents = serverTotal ?? (priced && shipping ? priced.subtotalCents - discount + shipping.priceCents : undefined);
      // uma chave por carrinho: reenvio (clique duplo, resposta perdida) devolve o mesmo pedido em vez de criar outro
      if (attempt.current?.cart !== key) attempt.current = { cart: key, id: crypto.randomUUID() };
      const r = await post("/api/checkout/order", { lines: stored, addressId, shippingService: shipping?.service, expectedTotalCents, idempotencyKey: attempt.current.id, couponCode: discount > 0 ? coupon?.code : undefined });
      const data = await r.json().catch(() => null);
      if (r.status === 201) {
        setDone(true);
        clear();
        router.replace(`/pedido/${encodeURIComponent(data.orderId)}`); // pagamento (cartao ou Pix) na pagina do pedido
        return;
      }
      if (data?.error === "TOTAL_ALTERADO") {
        // o servidor sempre vale: mostra o total novo e o proximo clique confirma exatamente esse valor
        setServerTotal(data.totalCents);
        setError(`O total do pedido mudou para ${formatBRL(data.totalCents)}. Clique em "Fazer pedido" para confirmar.`);
        return setBusy(false);
      }
      setServerTotal(null);
      if (data?.issues) setIssues(data.issues);
      setError(ORDER_ERRORS[data?.error] ?? "Não foi possível criar o pedido. Tente novamente.");
      if (r.status === 409) setRefresh((n) => n + 1); // recarrega carrinho e frete
    } catch {
      setError("Não foi possível criar o pedido. Tente novamente.");
    }
    setBusy(false);
  }

  if (done) return <p role="status">Pedido criado. Abrindo o pagamento…</p>;
  if (stored.length === 0) return <p>Seu carrinho está vazio. <Link href="/">Continuar comprando</Link></p>;
  if (!priced) return error ? <p role="alert">{error}</p> : <p>Carregando…</p>;
  const names = new Map(priced.lines.map((l) => [l.variantId, l.productName]));
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {issues.length > 0 && (
        <ul role="status" style={{ color: "#b45309", paddingLeft: 18 }}>
          {issues.map((i) => <li key={i.variantId}>{names.get(i.variantId) ?? "Um item do carrinho"}: {issueText(i)}</li>)}
        </ul>
      )}
      <section>
        <h2>Itens</h2>
        <ul className="cart-lines">
          {priced.lines.map((l) => (
            <li key={l.variantId} className="cart-line cart-line-compact">
              <span>{l.qty}× {l.productName} ({l.color} / {l.size})</span><span>{formatBRL(l.lineCents)}</span>
            </li>
          ))}
        </ul>
        <Link href="/carrinho">Alterar carrinho</Link>
      </section>
      <section>
        <h2>Endereço de entrega</h2>
        {addresses.length > 0 && (
          <fieldset style={{ border: 0, padding: 0 }}>
            <legend>Escolha o endereço:</legend>
            {addresses.map((a) => (
              <label key={a.id} style={{ display: "block", margin: "4px 0" }}>
                <input type="radio" name="address" checked={a.id === addressId} onChange={() => { setServerTotal(null); setAddressId(a.id); }} /> {addressLabel(a)}
              </label>
            ))}
          </fieldset>
        )}
        <details open={addresses.length === 0}>
          <summary>Novo endereço</summary>
          <AddressForm onCreated={(a) => { setAddresses((p) => [...p, a]); setAddressId(a.id); }} />
        </details>
      </section>
      {addressId && (
        <section>
          <h2>Frete</h2>
          {!options ? <p>Calculando frete…</p> : options.length === 0 ? <p role="status">Nenhuma opção de entrega para este endereço.</p> : options.map((o) => (
            <label key={o.service} style={{ display: "block", margin: "4px 0" }}>
              <input type="radio" name="shipping" checked={o.service === shipping?.service} onChange={() => { setServerTotal(null); setService(o.service); }} />{" "}
              {o.service}: {formatBRL(o.priceCents)} — {o.days} {o.days === 1 ? "dia útil" : "dias úteis"}
            </label>
          ))}
        </section>
      )}
      <section>
        <p>Subtotal: {formatBRL(priced.subtotalCents)}</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label>Cupom <input value={couponInput} onChange={(e) => setCouponInput(e.target.value)} maxLength={40} /></label>
          <button type="button" onClick={applyCoupon} disabled={!couponInput.trim()}>Aplicar</button>
          {couponMsg && <span role="alert">{couponMsg}</span>}
        </div>
        {discount > 0 && <p>Desconto ({coupon?.code}): −{formatBRL(discount)}</p>}
        <p>Frete: {shipping ? formatBRL(shipping.priceCents) : "—"}</p>
        <p style={{ fontSize: 18 }}>Total: <strong>{formatBRL(serverTotal ?? priced.subtotalCents - discount + (shipping?.priceCents ?? 0))}</strong></p>
        {error && <p role="alert">{error}</p>}
        <button type="button" onClick={placeOrder} disabled={busy || !shipping || !addressId || priced.lines.length === 0}
          style={{ padding: "10px 16px", background: "var(--primary, #111)", color: "var(--on-primary, #fff)", border: 0 }}>
          {busy ? "Enviando…" : "Fazer pedido"}
        </button>
      </section>
    </div>
  );
}
