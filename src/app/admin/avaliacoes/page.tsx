import Link from "next/link";
import { MasterForm } from "@/components/master-form";
import { listReviewsAdmin } from "@/domain/reviews";
import { parseListQuery } from "@/domain/adminOrders";
import { adminPage } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function AvaliacoesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { store, readOnly } = await adminPage();
  const { page: pageParam } = parseListQuery(await searchParams, ["page"]) ?? {};
  const { items, total, page, pageSize } = await listReviewsAdmin(store.id, pageParam ?? 1);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <main>
      <h1>Avaliações</h1>
      <p>Só clientes com pedido pago podem avaliar. Ocultar tira da vitrine sem apagar. {total} {total === 1 ? "avaliação" : "avaliações"}.</p>
      {items.length === 0 ? <p>Nenhuma avaliação ainda.</p> : items.map((r) => (
        <section key={r.id} style={{ border: "1px solid #ccc", padding: 12, margin: "8px 0", opacity: r.hidden ? 0.6 : 1 }}>
          <h2>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)} <small>{r.product.name} · {r.customer.name} · {r.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}{r.hidden ? " · oculta" : ""}</small></h2>
          {r.comment && <p style={{ whiteSpace: "pre-line" }}>{r.comment}</p>}
          {!readOnly && (
            <div style={{ display: "flex", gap: 8 }}>
              <MasterForm url={`/api/admin/reviews/${r.id}`} method="PATCH" submit={r.hidden ? "Mostrar" : "Ocultar"} extra={{ hidden: !r.hidden }} />
              <MasterForm url={`/api/admin/reviews/${r.id}`} method="DELETE" submit="Excluir" confirm="Excluir esta avaliação?" />
            </div>
          )}
        </section>
      ))}
      <p style={{ display: "flex", gap: 12 }}>
        {page > 1 && <Link href={`/admin/avaliacoes?page=${page - 1}`}>Anterior</Link>}
        <span>Página {page} de {pages}</span>
        {page < pages && <Link href={`/admin/avaliacoes?page=${page + 1}`}>Próxima</Link>}
      </p>
    </main>
  );
}
