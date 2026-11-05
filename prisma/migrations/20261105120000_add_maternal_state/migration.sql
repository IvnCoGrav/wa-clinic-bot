-- Fase 1: state maternal terstruktur pada reservasi
-- Usia kehamilan, tahap ibu kanonis, dan perkiraan HPL menjadi data first-class.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "gestational_weeks" INTEGER;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "mom_stage" TEXT;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "hpl_date" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "reservations_tenant_id_hpl_date_idx"
  ON "reservations"("tenant_id", "hpl_date");
