-- Fase 4: follow-up sadar tahap ibu (PREGNANT|POSTPARTUM|LACTATING|GENERAL).
ALTER TABLE "follow_ups" ADD COLUMN IF NOT EXISTS "mom_stage" TEXT;
