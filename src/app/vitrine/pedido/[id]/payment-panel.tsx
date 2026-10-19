"use client";

import { useEffect, useRef, useState } from "react";
import type { OrderStatus } from "@prisma/client";
import { formatBRL } from "@/domain/money";

type Pix = { qrCode: string; qrCodeBase64: string | null; expiresAt: string };
type CardInput = { token: string; installments: number; paymentMethodId: string };
type BrickController = { unmount(): void };
type MercadoPagoCtor = new (publicKey: string, opts: { locale: string }) => {
  bricks(): { create(name: "cardPayment", containerId: string, settings: unknown): Promise<BrickController> };
};

const PAY_ERRORS: Record<string, string> = {
  PAGAMENTO_RECUSADO: "Pagamento recusado. Tente outro cartão ou pague com Pix.",
  PAGAMENTO_INDISPONIVEL: "Não foi possível falar com o meio de pagamento. Tente novamente em instantes.",
  PAGAMENTO_NAO_CONFIGURADO: "Esta loja ainda não aceita pagamentos online.",
  PEDIDO_NAO_PENDENTE: "Este pedido não está mais aguardando pagamento.",
  PIX_EXPIRADO: "O Pix expirou. Faça um novo pedido.",
  MUITAS_REQUISICOES: "Muitas tentativas. Aguarde um minuto.",
  STORE_UNAVAILABLE: "Loja indisponível no momento.",
};
const STATUS_TEXT: Partial<Record<OrderStatus, string>> = {
  PAID: "Pagamento aprovado! Obrigado pela compra.",
  CANCELED: "Pedido cancelado (pagamento não concluído no prazo ou recusado).",
};
const SDK = "https://sdk.mercadopago.com/js/v2";

async function pay(orderId: string, body: { method: "pix" } | { method: "card"; card: CardInput }) {
  const r = await fetch("/api/checkout/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId, ...body }) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(PAY_ERRORS[data?.error] ?? "Não foi possível pagar. Tente novamente.");
  return data as { status: OrderStatus; pix?: Pix & { amountCents: number } };
}

function loadSdk(): Promise<MercadoPagoCtor> {
  const w = window as unknown as { MercadoPago?: MercadoPagoCtor };
  if (w.MercadoPago) return Promise.resolve(w.MercadoPago);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK;
    s.onload = () => (w.MercadoPago ? resolve(w.MercadoPago) : reject(new Error("SDK")));
    s.onerror = () => reject(new Error("SDK"));
    document.head.appendChild(s);
  });
}

/** Card Payment Brick: o cartao e digitado no iframe do MP; so o token chega ao nosso servidor. */
function CardBrick({ publicKey, totalCents, onCard }: { publicKey: string; totalCents: number; onCard: (c: CardInput) => Promise<void> }) {
  const onCardRef = useRef(onCard);
  useEffect(() => { onCardRef.current = onCard; });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let ctrl: BrickController | undefined;
    let live = true;
    loadSdk().then(async (MP) => {
      if (!live) return;
      ctrl = await new MP(publicKey, { locale: "pt-BR" }).bricks().create("cardPayment", "card-brick", {
        initialization: { amount: totalCents / 100 },
        customization: { paymentMethods: { maxInstallments: 3 } },
        callbacks: {
          onReady: () => {},
          onError: () => setFailed(true),
          onSubmit: (d: { token: string; installments: number; payment_method_id: string }) =>
            onCardRef.current({ token: d.token, installments: Number(d.installments), paymentMethodId: d.payment_method_id }),
        },
      });
      if (!live) ctrl.unmount();
    }).catch(() => live && setFailed(true));
    return () => { live = false; ctrl?.unmount(); };
  }, [publicKey, totalCents]);
  return failed ? <p role="alert">Não foi possível carregar o pagamento com cartão.</p> : <div id="card-brick" />;
}

type Props = { orderId: string; initialStatus: OrderStatus; totalCents: number; pixCents: number; initialPix: Pix | null };

/** Pagamento do pedido: Pix (QR + copia-e-cola) ou cartao. Consulta o status a cada 5 s enquanto aguarda pagamento. */
export function PaymentPanel({ orderId, initialStatus, totalCents, pixCents, initialPix }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [pix, setPix] = useState<Pix | null>(initialPix);
  const [method, setMethod] = useState<"pix" | "card" | null>(initialPix ? "pix" : null);
  const [config, setConfig] = useState<{ publicKey: string | null; fake: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!pix) return;
    const t = setTimeout(() => setExpired(true), Math.max(0, new Date(pix.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(t);
  }, [pix]);

  useEffect(() => {
    if (status !== "PENDING_PAYMENT") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/checkout/order/${encodeURIComponent(orderId)}/status`).catch(() => null);
      if (!r?.ok) return;
      const d = (await r.json()) as { status: OrderStatus; pixQrCode: string | null; pixExpiresAt: string | null };
      setStatus(d.status);
      if (d.pixQrCode && d.pixExpiresAt) setPix((p) => (p?.qrCode === d.pixQrCode ? p : { qrCode: d.pixQrCode!, qrCodeBase64: null, expiresAt: d.pixExpiresAt! }));
    }, 5000);
    return () => clearInterval(t);
  }, [orderId, status]);

  useEffect(() => {
    if (method !== "card" || config) return;
    fetch("/api/checkout/payment-config").then((r) => (r.ok ? r.json() : null)).then((c) => setConfig(c ?? { publicKey: null, fake: false }))
      .catch(() => setConfig({ publicKey: null, fake: false }));
  }, [method, config]);

  async function run(body: Parameters<typeof pay>[1]) {
    setBusy(true); setError(null);
    try {
      const r = await pay(orderId, body);
      setStatus(r.status);
      if (r.pix) setPix(r.pix);
    } catch (e) {
      setError((e as Error).message);
      if (body.method === "card") throw e; // o Brick mostra o erro e libera nova tentativa
    } finally {
      setBusy(false);
    }
  }

  if (status !== "PENDING_PAYMENT") return <p role="status" style={{ fontSize: 18 }}>{STATUS_TEXT[status] ?? `Status: ${status}`}</p>;
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h2>Pagamento</h2>
      <p role="status">Aguardando pagamento.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => { setMethod("pix"); if (!pix) void run({ method: "pix" }); }}>
          Pix: {formatBRL(pixCents)}
        </button>
        <button type="button" disabled={busy} onClick={() => setMethod("card")}>Cartão: {formatBRL(totalCents)} (até 3x)</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {method === "pix" && pix && (expired ? <p role="alert">O Pix expirou. Faça um novo pedido.</p> : (
        <div style={{ display: "grid", gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URI do QR gerado pelo Mercado Pago */}
          {pix.qrCodeBase64 && <img src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR Code do Pix" width={220} height={220} />}
          <label>Pix copia e cola:
            <textarea readOnly value={pix.qrCode} rows={3} style={{ width: "100%" }} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button type="button" onClick={() => navigator.clipboard?.writeText(pix.qrCode).then(() => setCopied(true))}>
            {copied ? "Copiado!" : "Copiar código"}
          </button>
          <p>Valor: <strong>{formatBRL(pixCents)}</strong>. Pague até {new Date(pix.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.</p>
        </div>
      ))}
      {method === "card" && (!config ? <p>Carregando…</p> : config.publicKey ? (
        <CardBrick publicKey={config.publicKey} totalCents={totalCents} onCard={(card) => run({ method: "card", card })} />
      ) : config.fake ? (
        <div style={{ display: "flex", gap: 8 }}>
          <span>Modo de teste (sem Mercado Pago):</span>
          <button type="button" disabled={busy} onClick={() => run({ method: "card", card: { token: "approved", installments: 1, paymentMethodId: "visa" } }).catch(() => {})}>Cartão aprovado</button>
          <button type="button" disabled={busy} onClick={() => run({ method: "card", card: { token: "rejected", installments: 1, paymentMethodId: "visa" } }).catch(() => {})}>Cartão recusado</button>
        </div>
      ) : <p role="alert">Pagamento com cartão indisponível nesta loja.</p>)}
    </section>
  );
}
