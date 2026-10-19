-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "pixAmountCents" INTEGER;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "suspendedByMaster" BOOLEAN NOT NULL DEFAULT false;
