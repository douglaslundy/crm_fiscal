-- AlterTable
ALTER TABLE "Order" ADD COLUMN "boletoUrl" TEXT,
ADD COLUMN "boletoBarcode" TEXT,
ADD COLUMN "boletoExpiresAt" TIMESTAMP(3);
