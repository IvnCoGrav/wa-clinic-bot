-- CG-05 (opsi flag): tandai reservasi non-same-day dari bot/agent yang slotnya
-- belum diverifikasi staf. TIDAK mengubah kolom `status` (hindari blast radius).
ALTER TABLE "reservations" ADD COLUMN "needs_staff_verification" BOOLEAN NOT NULL DEFAULT false;
