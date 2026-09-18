-- Migrasi bedah drift schema (temuan investigasi 2026-09-17):
-- 1. reservations.status: samakan DEFAULT 'confirmed' dengan schema.prisma (@default("confirmed")).
-- 2. tenants.settings: schema tidak mendeklarasikan default; kode sudah null-safe
--    (brand.ts, few-shot-exemplars.ts) sehingga DEFAULT warisan migrasi ensure aman dicabut.
-- 3. Buat tabel yang ada di schema tapi tidak pernah punya migrasi:
--    tenant_prompt_configs (dipakai TenantPromptConfigService) dan
--    clinic_policies (dipakai get_clinic_policy_faq DB-first).
-- SENGAJA DIKECUALIKAN: indeks messages_* — migrasi 20260913000000 sudah
-- menerapkan unique tenant-scoped dan schema.prisma kini diselaraskan ke sana
-- (@@unique([tenant_id, wa_message_id])), sehingga tidak ada aksi indeks di sini.

-- AlterTable: samakan default reservations.status dengan schema
ALTER TABLE "reservations" ALTER COLUMN "status" SET DEFAULT 'confirmed';

-- AlterTable: cabut default warisan tenants.settings agar selaras schema
ALTER TABLE "tenants" ALTER COLUMN "settings" DROP DEFAULT;

-- CreateTable: tenant_prompt_configs (belum pernah ada migrasinya)
CREATE TABLE "tenant_prompt_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "personality_tone" TEXT NOT NULL,
    "answering_hierarchy" TEXT NOT NULL,
    "negative_constraints" TEXT NOT NULL,
    "medical_overclaim_rules" TEXT NOT NULL,
    "created_by" TEXT,
    "change_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_prompt_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: clinic_policies (belum pernah ada migrasinya)
CREATE TABLE "clinic_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "factual_summary" TEXT NOT NULL,
    "suggested_reply" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_prompt_configs_tenant_id_is_active_idx" ON "tenant_prompt_configs"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "clinic_policies_tenant_id_idx" ON "clinic_policies"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_policies_tenant_id_topic_key" ON "clinic_policies"("tenant_id", "topic");
