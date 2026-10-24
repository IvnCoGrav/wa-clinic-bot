-- AlterTable
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "receipt_amount" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reservations_tenant_id_receipt_amount_idx" ON "reservations"("tenant_id", "receipt_amount");
