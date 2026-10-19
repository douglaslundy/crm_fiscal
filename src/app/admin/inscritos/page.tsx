import { MasterForm } from "@/components/master-form";
import { LIST_CAP, listSubscribers } from "@/domain/subscribers";
import { adminPage } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

export default async function InscritosPage() {
  const { store, readOnly } = await adminPage();
  const { items, total } = await listSubscribers(store.id);
  return (
    <main>
      <h1>Inscritos</h1>
      <p>E-mails de quem pediu para receber novidades pelo formulário da loja (com consentimento). {total} {total === 1 ? "inscrito" : "inscritos"}.</p>
      <p><a href="/api/admin/subscribers/export" download>Baixar CSV</a></p>
      {total > items.length && <p role="status">Mostrando os {LIST_CAP} mais recentes; o CSV traz a lista completa.</p>}
      {items.length === 0 ? <p>Ninguém se inscreveu ainda.</p> : (
        <table>
          <thead><tr><th>E-mail</th><th>Inscrito em</th><th /></tr></thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td>{s.email}</td>
                <td>{s.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td>{!readOnly && <MasterForm url={`/api/admin/subscribers/${s.id}`} method="DELETE" submit="Remover" confirm={`Remover ${s.email} da lista?`} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
