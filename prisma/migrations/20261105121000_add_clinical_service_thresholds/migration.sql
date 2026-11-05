-- Fase 2: ambang gestasional & keluarga klinis menjadi data DB (menutup #218).
ALTER TABLE "clinic_services" ADD COLUMN IF NOT EXISTS "min_gestational_weeks" INTEGER;
ALTER TABLE "clinic_services" ADD COLUMN IF NOT EXISTS "max_gestational_weeks" INTEGER;
ALTER TABLE "clinic_services" ADD COLUMN IF NOT EXISTS "clinical_family" TEXT;

-- Seed awal (default tenant). Admin dapat mengubah nilainya via /api/admin/services.
UPDATE "clinic_services" SET clinical_family = 'INDUCTION', min_gestational_weeks = 37
  WHERE service_id IN ('moms-induksi-massage','moms-induksi-fullbody');
UPDATE "clinic_services" SET clinical_family = 'PERINEUM', min_gestational_weeks = 34
  WHERE service_id = 'moms-perineum-massage';
UPDATE "clinic_services" SET clinical_family = 'PRENATAL'
  WHERE service_id IN ('moms-prenatal-massage','moms-prenatal-yoga');
UPDATE "clinic_services" SET clinical_family = 'LACTATION'
  WHERE service_id IN ('moms-paket-laktasi','moms-oksitosin','moms-oksitosin-fullbody');
UPDATE "clinic_services" SET clinical_family = 'POSTPARTUM'
  WHERE service_id = 'moms-postpartum-massage';
