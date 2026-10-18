import { z } from "zod";

export const PlanBody = z.object({
  name: z.string().trim().min(1).max(60),
  priceCents: z.number().int().min(0),
  productLimit: z.number().int().min(1).nullable(),
  staffLimit: z.number().int().min(1),
  customDomain: z.boolean(),
  advancedMetrics: z.boolean(),
  csvExport: z.boolean(),
  transactionFeeBps: z.number().int().min(0).max(10000).optional(),
});
