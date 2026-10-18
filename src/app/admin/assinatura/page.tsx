import { redirect } from "next/navigation";
import { formatBRL } from "@/domain/money";
import {
  SubscriptionActionError, cancelStoreSubscription, changeStorePlan, startCheckout,
} from "@/domain/subscription";
import { getBilling } from "@/integrations/billing";
import { prisma } from "@/lib/db";
import { requireStoreMember } from "@/lib/guards";
import { getCurrentStore } from "@/lib/tenant";
import { errorMessage } from "./messages";

export const dynamic = "force-dynamic";

// Sem assertStoreWritable aqui: loja suspensa precisa desta pagina para pagar e voltar a vender.
const PAGE = "/admin/assinatura";
const STATUS: Record<string, string> = { TRIAL: "Em teste", ACTIVE: "Ativa", SUSPENDED: "Suspensa", CANCELED: "Cancelada" };
const SUB: Record<string, string> = { TRIALING: "Teste grátis", ACTIVE: "Em dia", PAST_DUE: "Pagamento em atraso", SUSPENDED: "Suspensa", CANCELED: "Cancelada" };
const fmt = (d: Date | null | undefined) => (d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-");

async function owner() {
  const store = await getCurrentStore();
  const session = await requireStoreMember(store.id, "OWNER");
  return { store, session };
}
/** Executa a acao e redireciona: erro conhecido volta com ?erro=, sucesso vai para `to`. */
async function run(fn: () => Promise<string>) {
  let to: string;
  try {
    to = await fn();
  } catch (e) {
    if (e instanceof SubscriptionActionError) redirect(`${PAGE}?erro=${e.code}`);
    throw e;
  }
  redirect(to);
}

async function assinar(form: FormData) {
  "use server";
  const { store, session } = await owner();
  // sucesso: segue para o link de pagamento
  await run(() => startCheckout(store.id, String(form.get("planId")), session.user.email ?? "", getBilling()));
}

async function trocar(form: FormData) {
  "use server";
  const { store } = await owner();
  await run(() => changeStorePlan(store.id, String(form.get("planId")), getBilling()).then(() => `${PAGE}?ok=plano`));
}

async function cancelar(form: FormData) {
  "use server";
  const { store } = await owner();
  if (form.get("confirmar") !== "sim") redirect(`${PAGE}?erro=CONFIRMAR`);
  await run(() => cancelStoreSubscription(store.id, getBilling(), new Date()).then(() => `${PAGE}?ok=cancelada`));
}

type Props = { searchParams: Promise<{ erro?: string; ok?: string }> };

export default async function AssinaturaPage({ searchParams }: Props) {
  const { store } = await owner();
  const sp = await searchParams;
  const [plan, sub, plans] = await Promise.all([
    prisma.plan.findUniqueOrThrow({ where: { id: store.planId } }),
    prisma.subscription.findUnique({ where: { storeId: store.id } }),
    prisma.plan.findMany({ where: { active: true }, orderBy: { priceCents: "asc" } }),
  ]);
  const subStatus = sub?.status ?? "TRIALING";
  const canSubscribe = subStatus !== "ACTIVE" && subStatus !== "PAST_DUE";
  const planSelect = (
    <select name="planId" defaultValue={plan.id} required>
      {plans.map((p) => <option key={p.id} value={p.id}>{p.name} - {formatBRL(p.priceCents)}/mês</option>)}
    </select>
  );

  return (
    <main>
      <h1>Assinatura</h1>
      {sp.erro && <p role="alert">{errorMessage(sp.erro)}</p>}
      {sp.ok === "plano" && <p role="status">Plano alterado.</p>}
      {sp.ok === "cancelada" && <p role="status">Assinatura cancelada.</p>}

      <dl>
        <dt>Plano atual</dt><dd>{plan.name} - {formatBRL(plan.priceCents)}/mês</dd>
        <dt>Loja</dt><dd>{STATUS[store.status]}</dd>
        <dt>Assinatura</dt><dd>{SUB[subStatus]}</dd>
        {store.status === "TRIAL" && <><dt>Teste termina em</dt><dd>{fmt(store.trialEndsAt)}</dd></>}
        {subStatus === "ACTIVE" && <><dt>Próximo pagamento</dt><dd>{fmt(sub?.currentPeriodEnd)}</dd></>}
        {subStatus === "PAST_DUE" && <><dt>Prazo para regularizar</dt><dd>{fmt(store.graceEndsAt)}</dd></>}
      </dl>
      {store.status === "SUSPENDED" && <p>Sua loja está suspensa: a vitrine não vende e o painel fica só leitura até o pagamento.</p>}

      {canSubscribe ? (
        <form action={assinar}>
          <h2>Assinar</h2>
          {planSelect} <button type="submit">Gerar link de pagamento</button>
        </form>
      ) : (
        <form action={trocar}>
          <h2>Trocar plano</h2>
          {planSelect} <button type="submit" disabled={subStatus !== "ACTIVE"}>Trocar plano</button>
        </form>
      )}

      {subStatus !== "CANCELED" && (
        <form action={cancelar}>
          <h2>Cancelar assinatura</h2>
          <label><input type="checkbox" name="confirmar" value="sim" /> Confirmo que quero cancelar. A loja deixa de vender.</label>{" "}
          <button type="submit">Cancelar assinatura</button>
        </form>
      )}
    </main>
  );
}
