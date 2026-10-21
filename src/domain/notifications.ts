import { dbForStore } from "@/lib/db-store";
import { prisma } from "@/lib/db";
import { sendMail } from "@/integrations/email";
import { storeOrigin } from "@/lib/urls";
import { formatBRL } from "./money";
import { requestEmailVerification } from "./passwordReset";

/** Pedido pago: confirmacao ao cliente. Nunca lanca (e-mail nao pode desfazer o pagamento). */
export async function notifyOrderPaid(storeId: string, orderId: string): Promise<void> {
  try {
    const [order, store] = await Promise.all([
      dbForStore(storeId).order.findFirst({ where: { id: orderId }, select: { id: true, totalCents: true, customer: { select: { name: true, email: true } } } }),
      prisma.store.findUnique({ where: { id: storeId }, select: { name: true, slug: true } }),
    ]);
    if (!order || !store) return;
    await sendMail({
      to: order.customer.email,
      subject: `Pagamento confirmado - ${store.name}`,
      text: `Olá, ${order.customer.name.split(/\s+/)[0]}!\n\nRecebemos o pagamento do seu pedido de ${formatBRL(order.totalCents)} em ${store.name}.\nAcompanhe em: ${storeOrigin(store.slug)}/pedido/${order.id}\n\nObrigado pela compra!`,
    });
  } catch (e) {
    console.error("[e-mail] notifyOrderPaid", orderId, e instanceof Error ? e.message : e);
  }
}

export const sendInviteEmail = (to: string, storeName: string, url: string) =>
  sendMail({ to, subject: `Convite para a equipe de ${storeName}`, text: `Você foi convidado para a equipe de ${storeName}.\nCrie sua conta pelo link (vale 7 dias, uso único):\n${url}` });

export const sendPasswordResetEmail = (to: string, name: string, url: string) =>
  sendMail({ to, subject: "Redefinição de senha", text: `Olá, ${name.split(/\s+/)[0]}.\n\nPara criar uma nova senha, acesse (vale 1 hora, uso único):\n${url}\n\nSe você não pediu, ignore este e-mail.` });

/** Confirmacao de e-mail no cadastro. Nao bloqueia o login; nunca lanca (falha de envio nao desfaz o cadastro). */
export async function sendVerifyEmail(kind: "ACCOUNT" | "CUSTOMER", subjectId: string, to: string, name: string, origin: string): Promise<void> {
  try {
    const token = await requestEmailVerification(kind, subjectId);
    await sendMail({ to, subject: "Confirme seu e-mail", text: `Olá, ${name.split(/\s+/)[0]}.\n\nConfirme seu e-mail pelo link (vale 7 dias):\n${origin}/verificar-email/${token}\n\nSe você não criou uma conta, ignore este e-mail.` });
  } catch (e) {
    console.error("[e-mail] sendVerifyEmail", subjectId, e instanceof Error ? e.message : e);
  }
}
