export const STATUS_LABEL: Record<string, string> = { TRIAL: "Em teste", ACTIVE: "Ativa", SUSPENDED: "Suspensa", CANCELED: "Cancelada" };
export const SUB_LABEL: Record<string, string> = { TRIALING: "Teste grátis", ACTIVE: "Em dia", PAST_DUE: "Pagamento em atraso", SUSPENDED: "Suspensa", CANCELED: "Cancelada" };
export const fmtDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-");
