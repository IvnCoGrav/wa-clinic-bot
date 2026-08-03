-- Status delivery pesan dari webhook status Meta (sent/delivered/read/failed).
-- dipakai observasi pengiriman + alert template failed.

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "delivery_status" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "delivered_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "read_at" TIMESTAMP(3);
