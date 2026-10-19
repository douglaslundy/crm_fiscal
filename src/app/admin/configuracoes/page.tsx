import { MasterForm } from "@/components/master-form";
import { cnameTarget, getDomain } from "@/domain/customDomain";
import { CREDENTIAL_FIELDS, MAX_PIX_DISCOUNT, getCredentialStatus, getSettings, type CredentialField } from "@/domain/storeSettings";
import { listInvites, listTeam } from "@/domain/team";
import { InviteForm } from "@/components/invite-form";
import { adminPage } from "@/lib/admin-api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const LABELS: Record<CredentialField, string> = {
  mpAccessToken: "Mercado Pago: Access Token",
  mpPublicKey: "Mercado Pago: Public Key",
  mpWebhookSecret: "Mercado Pago: segredo do webhook",
  melhorEnvioToken: "Melhor Envio: token",
};

export default async function ConfiguracoesPage() {
  const { store, session, readOnly } = await adminPage();
  // So exibicao: as rotas de credenciais/equipe/dominio checam OWNER de novo no servidor.
  const me = await prisma.account.findUnique({
    where: { id: session.user.id },
    select: { isMaster: true, memberships: { where: { storeId: store.id }, select: { role: true } } },
  });
  const isOwner = Boolean(me?.isMaster || me?.memberships[0]?.role === "OWNER");
  const settings = await getSettings(store.id);
  const plan = await prisma.plan.findUnique({ where: { id: store.planId }, select: { customDomain: true } });

  return (
    <main>
      <h1>Configurações</h1>
      {readOnly && <p role="status">Loja suspensa: as configurações ficam somente para leitura.</p>}

      <section>
        <h2>Loja</h2>
        <p>CEP de origem dos envios: {settings.originCep}. Desconto no Pix: {settings.pixDiscountPercent}%.</p>
        {!readOnly && (
          <MasterForm url="/api/admin/settings" method="PATCH" submit="Salvar" fields={[
            { name: "originCep", label: "CEP de origem", defaultValue: settings.originCep, required: true },
            { name: "pixDiscountPercent", label: "Desconto no Pix (%)", type: "number", defaultValue: settings.pixDiscountPercent, required: true, max: MAX_PIX_DISCOUNT },
          ]} />
        )}
      </section>

      {isOwner && <OwnerSections storeId={store.id} accountId={session.user.id} readOnly={readOnly} customDomain={Boolean(plan?.customDomain)} />}
    </main>
  );
}

async function OwnerSections(p: { storeId: string; accountId: string; readOnly: boolean; customDomain: boolean }) {
  const [creds, team, domain, invites] = await Promise.all([getCredentialStatus(p.storeId), listTeam(p.storeId), getDomain(p.storeId), listInvites(p.storeId)]);
  const status = (f: CredentialField) => creds[f].configured ? `configurado${creds[f].last4 ? ` ••••${creds[f].last4}` : ""}` : "não configurado";

  return (
    <>
      <section>
        <h2>Credenciais</h2>
        <p>Os valores ficam guardados criptografados e nunca são exibidos. Deixe o campo vazio para manter o atual.</p>
        <ul>{CREDENTIAL_FIELDS.map((f) => <li key={f}>{LABELS[f]}: {status(f)}</li>)}</ul>
        {!p.readOnly && (
          <>
            <MasterForm url="/api/admin/credentials" method="PATCH" submit="Salvar credenciais"
              fields={CREDENTIAL_FIELDS.map((f) => ({ name: f, label: `${LABELS[f]} (${status(f)})`, type: "password" as const }))} />
            {CREDENTIAL_FIELDS.filter((f) => creds[f].configured).map((f) => (
              <MasterForm key={f} url="/api/admin/credentials" method="PATCH" submit={`Remover ${LABELS[f]}`} extra={{ clear: [f] }} confirm={`Remover ${LABELS[f]}?`} />
            ))}
          </>
        )}
      </section>

      <section>
        <h2>Equipe</h2>
        <ul>
          {team.map((m) => (
            <li key={m.accountId}>
              {m.name} ({m.email}): {m.role === "OWNER" ? "dono" : "colaborador"}
              {!p.readOnly && m.role === "STAFF" && m.accountId !== p.accountId && (
                <MasterForm url={`/api/admin/team/${m.accountId}`} method="DELETE" submit="Remover" confirm={`Remover ${m.name} da equipe?`} />
              )}
            </li>
          ))}
        </ul>
        {invites.length > 0 && (
          <>
            <h3>Convites pendentes</h3>
            <ul>
              {invites.map((i) => (
                <li key={i.id}>
                  {i.email} (vence em {i.expiresAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })})
                  {!p.readOnly && <MasterForm url={`/api/admin/team/invites/${i.id}`} method="DELETE" submit="Cancelar convite" confirm={`Cancelar o convite de ${i.email}?`} />}
                </li>
              ))}
            </ul>
          </>
        )}
        {!p.readOnly && (
          <>
            <p>Quem já tem cadastro entra direto; e-mail novo recebe um link de convite.</p>
            <InviteForm />
          </>
        )}
      </section>

      <section>
        <h2>Domínio próprio</h2>
        {!p.customDomain ? (
          <p>Seu plano não inclui domínio próprio. Faça upgrade em Assinatura para usar um.</p>
        ) : (
          <>
            {domain.host ? (
              <p>{domain.host}: {domain.verified ? "verificado" : "aguardando verificação"}.</p>
            ) : <p>Nenhum domínio cadastrado.</p>}
            <p>
              No painel do seu provedor de domínio, crie um registro <strong>CNAME</strong> apontando o seu domínio para{" "}
              <code>{cnameTarget()}</code>. A propagação pode levar algumas horas; depois clique em Verificar.
              Use um subdomínio como www (domínio raiz não aceita CNAME na maioria dos provedores).
            </p>
            {!p.readOnly && (
              <>
                <MasterForm url="/api/admin/domain" method="PATCH" submit="Salvar domínio"
                  fields={[{ name: "host", label: "Domínio (ex.: www.minhaloja.com.br)", defaultValue: domain.host, required: true }]} />
                {domain.host && <MasterForm url="/api/admin/domain/verify" submit="Verificar" />}
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}
