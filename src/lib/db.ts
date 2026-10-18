import { PrismaClient } from "@prisma/client";

// Cliente bruto, sem escopo de loja: so para codigo de plataforma (master, billing, seed).
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;
