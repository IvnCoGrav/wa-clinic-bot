-- Stage 2 (Audit R1 / RC-01): Tenant Identity Boundary.
-- Ubah keunikan nomor HP dari GLOBAL (@unique) menjadi PER-TENANT (@@unique([tenant_id, phone])).
-- Prasyarat terverifikasi (read-only 2026-09-20): 0 phone multi-tenant, 0 drift.

-- DropIndex
DROP INDEX "customers_phone_key";

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_phone_key" ON "customers"("tenant_id", "phone");
