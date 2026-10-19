import { MasterForm, type Field } from "@/components/master-form";
import { listCoupons } from "@/domain/coupons";
import { formatBRL } from "@/domain/money";
import { adminPage } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof listCoupons>>[number];

const day = (d: Date | null, end = false) => (d ? new Date(d.getTime() - (end ? 86_400_000 : 0) - 3 * 3600_000).toISOString().slice(0, 10) : "");
const valueText = (c: Row) => (c.kind === "PERCENT" ? `${c.value}%` : formatBRL(c.value));

export default async function CuponsPage() {
  const { store, readOnly } = await adminPage();
  const rows = await listCoupons(store.id);
  const fields = (c?: Row): Field[] => [
    ...(c ? [] : [{ name: "code", label: "Código (letras, números, - e _)", required: true } as Field]),
    { name: "kind", label: "Tipo", type: "select", defaultValue: c?.kind ?? "PERCENT", options: [{ value: "PERCENT", label: "Percentual (%)" }, { value: "FIXED", label: "Valor fixo (centavos)" }] },
    { name: "value", label: "Valor (% ou centavos)", type: "number", defaultValue: c?.value, required: true },
    { name: "minSubtotalCents", label: "Subtotal mínimo (centavos)", type: "number", defaultValue: c?.minSubtotalCents ?? 0 },
    { name: "maxUses", label: "Limite de usos (vazio = ilimitado)", type: "number", nullable: true, defaultValue: c?.maxUses },
    { name: "startsAt", label: "Válido a partir de", type: "date", defaultValue: day(c?.startsAt ?? null) },
    { name: "expiresAt", label: "Válido até (inclusive)", type: "date", defaultValue: day(c?.expiresAt ?? null, true) },
    { name: "active", label: "Ativo", type: "checkbox", defaultValue: c?.active ?? true },
  ];
  return (
    <main>
      <h1>Cupons</h1>
      <p>O desconto vale sobre os itens (não sobre o frete). Cada cliente usa o mesmo cupom uma vez; pedido cancelado devolve o uso.</p>
      {readOnly && <p role="status">Loja suspensa: os cupons ficam somente para leitura.</p>}
      {rows.length === 0 && <p>Nenhum cupom ainda.</p>}
      {rows.map((c) => (
        <section key={c.id} style={{ border: "1px solid #ccc", padding: 12, margin: "8px 0" }}>
          <h2>{c.code} <small>{valueText(c)} · {c.usedCount}{c.maxUses ? `/${c.maxUses}` : ""} usos · {c.active ? "ativo" : "inativo"}</small></h2>
          {!readOnly && (
            <details>
              <summary>Editar</summary>
              <MasterForm url={`/api/admin/coupons/${c.id}`} method="PATCH" submit="Salvar" fields={fields(c)} />
              <MasterForm url={`/api/admin/coupons/${c.id}`} method="DELETE" submit="Excluir" confirm={`Excluir o cupom ${c.code}?`} />
            </details>
          )}
        </section>
      ))}
      {!readOnly && (
        <section>
          <h2>Novo cupom</h2>
          <MasterForm url="/api/admin/coupons" submit="Criar cupom" fields={fields()} />
        </section>
      )}
    </main>
  );
}
