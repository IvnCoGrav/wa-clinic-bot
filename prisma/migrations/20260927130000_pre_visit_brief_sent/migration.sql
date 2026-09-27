-- Fase 5r: Pre-Visit Brief idempotency — kolom penanda kartu ringkasan pasien
-- sudah dikirim ke bidan (cegah kirim ganda cron + trigger same-day).
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "pre_visit_brief_sent_at" TIMESTAMP(3);
