-- API-04 (W17): AdminSession memiliki tenant_id (otoritas server, bukan header klien).
--
-- Sebelumnya sesi admin tidak menyimpan tenant, sehingga `x-tenant-id` dari klien
-- menentukan tenant data yang diakses. Setelah migrasi:
-- - sesi dibuat dengan tenant dari request login,
-- - preHandler memakai tenant sesi (bukan header) saat cookie valid.
--
-- SQL dari `prisma migrate diff --from-schema-datamodel <HEAD> --to-schema-datamodel <baru>`.

-- AlterTable
ALTER TABLE "admin_sessions" ADD COLUMN     "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant';

-- CreateIndex
CREATE INDEX "admin_sessions_tenant_id_idx" ON "admin_sessions"("tenant_id");
