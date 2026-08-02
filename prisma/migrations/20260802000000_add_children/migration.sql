-- RUNBOOK / DEPLOY PITFALL (2026-08-02):
-- Migration ini pernah tercatat "failed" di _prisma_migrations (finished_at = NULL)
-- meski tabel "children" sudah terlanjur dibuat. Akibatnya `prisma migrate deploy`
-- ke environment yang terdampak gagal di tengah jalan:
--
--   ERROR: relation "children" already exists
--
-- FIX (jalankan sekali, JANGAN drop tabel children):
--   npx prisma migrate resolve --applied 20260802000000_add_children
--   npx prisma migrate deploy
--
-- Verifikasi zero drift (wajib output "-- This is an empty migration."):
--   npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script

-- CreateTable
CREATE TABLE "children" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "customer_id" TEXT NOT NULL,
    "reservation_id" TEXT,
    "name" TEXT NOT NULL,
    "birth_date" TIMESTAMP(3),
    "age_months_at_registration" INTEGER,
    "raw_age_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "children_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "children_customer_id_name_key" ON "children"("customer_id", "name");

-- CreateIndex
CREATE INDEX "children_tenant_id_idx" ON "children"("tenant_id");

-- AddForeignKey
ALTER TABLE "children" ADD CONSTRAINT "children_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "children" ADD CONSTRAINT "children_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
