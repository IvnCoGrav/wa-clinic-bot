-- AlterTable: Add duration_minutes to reservations (dukung HOLD & reservasi treatment >1 jam)
ALTER TABLE "reservations" ADD COLUMN "duration_minutes" INTEGER;
