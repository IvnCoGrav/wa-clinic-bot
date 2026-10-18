-- AlterTable
ALTER TABLE "clinic_services" ADD COLUMN IF NOT EXISTS "eligible_life_stages" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "clinic_services" ADD COLUMN IF NOT EXISTS "contraindications" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "clinic_services" ADD COLUMN IF NOT EXISTS "requires_screening" BOOLEAN NOT NULL DEFAULT false;
