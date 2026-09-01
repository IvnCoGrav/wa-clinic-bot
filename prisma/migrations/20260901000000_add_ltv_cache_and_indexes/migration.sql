-- AlterTable: Add ltv_cache column
ALTER TABLE "customers" ADD COLUMN "ltv_cache" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex: Composite indexes for customer list performance
CREATE INDEX "customers_tenant_sandbox_idx" ON "customers"("tenant_id", "is_sandbox_test");
CREATE INDEX "customers_tenant_mql_idx" ON "customers"("tenant_id", "is_mql");
CREATE INDEX "customers_tenant_sandbox_created_idx" ON "customers"("tenant_id", "is_sandbox_test", "created_at");
CREATE INDEX "customers_ltv_cache_idx" ON "customers"("ltv_cache");

-- Backfill ltv_cache from existing reservations
UPDATE "customers" c SET "ltv_cache" = COALESCE(
  (SELECT SUM(r."purchase_value") FROM "reservations" r WHERE r."customer_id" = c."id" AND r."status" NOT IN ('cancelled', 'rejected')),
  0
);
