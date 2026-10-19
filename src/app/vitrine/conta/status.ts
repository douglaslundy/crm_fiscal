import type { OrderStatus } from "@prisma/client";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Aguardando pagamento", PAID: "Pago", SHIPPED: "Enviado", DELIVERED: "Entregue", CANCELED: "Cancelado",
};
