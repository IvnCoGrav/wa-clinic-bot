-- SEC-AUDIT-14: soft-delete customer untuk command /reset (arsip, bukan hard delete).
-- Data anak/percakapan/reservasi tetap utuh; admin dapat memulihkan.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "customers_tenant_id_deleted_at_idx" ON "customers"("tenant_id", "deleted_at");
