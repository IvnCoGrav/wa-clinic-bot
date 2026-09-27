-- Buffer notifikasi penugasan terapis: notifikasi Telegram ke terapis baru ditunda
-- 5 menit agar admin dapat mengoreksi salah pilih terapis/jam. Persisten agar
-- survive restart & multi-instance (disapu oleh cron assignment sweep).
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "assignment_pending_staff_id" TEXT;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "assignment_pending_at" TIMESTAMP(3);
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "assignment_notified_at" TIMESTAMP(3);
