"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { add, read, serverSnapshot, subscribe } from "@/lib/cart-store";
import { PriceInfo } from "../../catalog-view";
import { ShippingQuote } from "../../shipping-quote";

type Variant = { id: string; color: string; size: string; priceCents: number; stock: number };
type Image = { url: string; color: string | null };

/** Escolha de cor/tamanho: preco e estoque da variacao escolhida; combinacao esgotada fica desabilitada. */
export function ProductOptions({ name, variants, images, pixPercent }: { name: string; variants: Variant[]; images: Image[]; pixPercent: number }) {
  const colors = [...new Set(variants.map((v) => v.color))];
  const sizes = [...new Set(variants.map((v) => v.size))];
  const [color, setColor] = useState(colors.length === 1 ? colors[0] : "");
  const [size, setSize] = useState(sizes.length === 1 ? sizes[0] : "");
  const find = (c: string, s: string) => variants.find((v) => v.color === c && v.size === s);
  const chosen = find(color, size);
  const inCart = useSyncExternalStore(subscribe, read, serverSnapshot).find((l) => l.variantId === chosen?.id)?.qty ?? 0;
  const [added, setAdded] = useState<"ok" | "fail" | null>(null);
  const [addedFor, setAddedFor] = useState(chosen?.id); // variacao a que o aviso se refere
  if (addedFor !== chosen?.id) { setAddedFor(chosen?.id); setAdded(null); }
  const canAdd = !!chosen && chosen.stock > inCart; // o servidor revalida de qualquer forma
  const image = images.find((i) => color && i.color === color) ?? images[0];
  const price = chosen?.priceCents ?? Math.min(...variants.map((v) => v.priceCents));
  const chip = (active: boolean, disabled: boolean) => ({
    padding: "6px 10px", marginRight: 6, marginBottom: 6, borderRadius: 4, border: active ? "2px solid #111" : "1px solid #999",
    background: disabled ? "#eee" : "#fff", color: disabled ? "#999" : "#111", textDecoration: disabled ? "line-through" : "none",
  });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
      <div style={{ flex: "1 1 280px", maxWidth: 480 }}>
        <div style={{ aspectRatio: "1", background: "#f4f4f4" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {image && <img src={image.url} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
      </div>
      <div style={{ flex: "1 1 280px" }}>
        <h1 style={{ marginTop: 0 }}>{name}</h1>
        <PriceInfo priceCents={price} pixPercent={pixPercent} />
        <fieldset style={{ border: 0, padding: 0, margin: "16px 0 8px" }}>
          <legend>Cor</legend>
          {colors.map((c) => {
            const out = !variants.some((v) => v.color === c && v.stock > 0);
            return <button key={c} type="button" aria-pressed={c === color} disabled={out} style={chip(c === color, out)} onClick={() => setColor(c)}>{c}</button>;
          })}
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: "8px 0" }}>
          <legend>Tamanho</legend>
          {sizes.map((s) => {
            const v = color ? find(color, s) : undefined;
            const out = color ? !v || v.stock === 0 : !variants.some((x) => x.size === s && x.stock > 0);
            return <button key={s} type="button" aria-pressed={s === size} disabled={out} style={chip(s === size, out)} onClick={() => setSize(s)}>{s}</button>;
          })}
        </fieldset>
        {chosen && chosen.stock === 0 && <p role="status">Esgotado</p>}
        {chosen && chosen.stock === 1 && <p role="status" style={{ color: "#b45309", fontWeight: 600 }}>Última peça!</p>}
        {!variants.some((v) => v.stock > 0) && <p role="status">Esgotado</p>}
        <button type="button" disabled={!canAdd} style={{ padding: "10px 16px", marginTop: 8 }}
          onClick={() => { if (chosen) setAdded(add(chosen.id, 1) ? "ok" : "fail"); }}>Adicionar ao carrinho</button>
        {!chosen && <p style={{ fontSize: 14 }}>Escolha cor e tamanho.</p>}
        {chosen && inCart >= chosen.stock && chosen.stock > 0 && <p role="status">Você já tem todas as unidades no carrinho.</p>}
        {added === "ok" && <p role="status">Adicionado ao carrinho. <Link href="/carrinho">Ver carrinho</Link></p>}
        {added === "fail" && <p role="alert">Não foi possível salvar o carrinho neste navegador.</p>}
        {chosen && chosen.stock > 0 && <ShippingQuote key={chosen.id} lines={[{ variantId: chosen.id, qty: 1 }]} />}
      </div>
    </div>
  );
}
