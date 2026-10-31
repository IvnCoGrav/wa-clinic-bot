-- Fase 1: follow-up state-gated per kategori treatment.
-- Menyimpan kategori treatment pada baris follow-up agar pemilihan keluarga
-- template (MOMS vs ANAK) bersandar pada state baris itu sendiri, bukan pada
-- relasi reservasi yang bisa NULL (reservation_id nullable / onDelete: SetNull).
ALTER TABLE "follow_ups" ADD COLUMN "treatment_category" "TreatmentCategory";
