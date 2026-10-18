import type { SubscriptionActionCode } from "@/domain/subscription";

const ERRORS: Record<SubscriptionActionCode | "CONFIRMAR", string> = {
  PLAN_NOT_AVAILABLE: "Plano indisponível.",
  ALREADY_SUBSCRIBED: "Você já tem uma assinatura. Use \"Trocar plano\".",
  NO_ACTIVE_SUBSCRIPTION: "Só é possível trocar de plano com a assinatura em dia.",
  CONFIRMAR: "Marque a confirmação para cancelar.",
};

/** Mensagem para ?erro=; so chaves proprias (nada de "constructor"/"toString"), senao generica. */
export function errorMessage(code: string): string {
  return Object.hasOwn(ERRORS, code) ? ERRORS[code as keyof typeof ERRORS] : "Não foi possível concluir.";
}
