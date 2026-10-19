-- CreateTable
CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscriber_storeId_email_key" ON "Subscriber"("storeId", "email");
CREATE UNIQUE INDEX "Subscriber_storeId_id_key" ON "Subscriber"("storeId", "id");

ALTER TABLE "Subscriber" ADD CONSTRAINT "Subscriber_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
