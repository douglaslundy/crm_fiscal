-- AlterTable
ALTER TABLE "Order" ADD COLUMN "pixQrBase64" TEXT,
ADD COLUMN "paymentMethod" TEXT;

-- Backfill: metodo inferido ate aqui
UPDATE "Order" SET "paymentMethod" = 'pix' WHERE "pixQrCode" IS NOT NULL;
UPDATE "Order" SET "paymentMethod" = 'card' WHERE "pixQrCode" IS NULL AND "mpPaymentId" IS NOT NULL;

-- CreateTable
CREATE TABLE "StoreInvite" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreInvite_tokenHash_key" ON "StoreInvite"("tokenHash");
CREATE UNIQUE INDEX "StoreInvite_storeId_email_key" ON "StoreInvite"("storeId", "email");

ALTER TABLE "StoreInvite" ADD CONSTRAINT "StoreInvite_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
