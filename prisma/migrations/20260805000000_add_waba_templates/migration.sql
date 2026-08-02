-- WABA Integration Phase 4: HSM Template registry + FollowUp SKIPPED status
-- Adds:
--   enum FollowUpStatus value "SKIPPED" (consent gatekeeper / template-not-approved skip)
--   table "waba_templates" (per-tenant HSM template mapping + approval status)

-- AlterEnum
ALTER TYPE "FollowUpStatus" ADD VALUE 'SKIPPED';

-- CreateTable
CREATE TABLE "waba_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "type" TEXT NOT NULL,
    "variant" INTEGER NOT NULL,
    "template_name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "language_code" TEXT NOT NULL DEFAULT 'id',
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waba_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waba_templates_tenant_id_type_variant_key" ON "waba_templates"("tenant_id", "type", "variant");

-- CreateIndex
CREATE INDEX "waba_templates_tenant_id_type_idx" ON "waba_templates"("tenant_id", "type");
