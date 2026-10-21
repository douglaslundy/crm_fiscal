-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('PDV', 'SALAO', 'DELIVERY', 'AGENDADO');

-- CreateEnum
CREATE TYPE "KitchenStatus" AS ENUM ('RECEIVED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "pricePerKg" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "priceCents" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "orderType" "OrderType";
ALTER TABLE "Order" ADD COLUMN "tableNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "scheduledFor" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "kitchenStatus" "KitchenStatus";

-- CreateTable
CREATE TABLE "ProductAddon" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "multiple" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductAddon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductAddon_storeId_idx" ON "ProductAddon"("storeId");

-- CreateIndex
CREATE INDEX "ProductAddon_productId_idx" ON "ProductAddon"("productId");

-- AddForeignKey
ALTER TABLE "ProductAddon" ADD CONSTRAINT "ProductAddon_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAddon" ADD CONSTRAINT "ProductAddon_storeId_productId_fkey" FOREIGN KEY ("storeId", "productId") REFERENCES "Product"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
