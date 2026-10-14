-- AlterTable
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "receipt_reference" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reservations_tenant_id_receipt_reference_idx" ON "reservations"("tenant_id", "receipt_reference");
