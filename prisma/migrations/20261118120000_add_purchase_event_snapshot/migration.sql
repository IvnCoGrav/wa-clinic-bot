-- Migration: add_purchase_event_snapshot (Task 2.2 / A-014a / A-002)
-- Menambahkan snapshot purchase_event_id dan purchase_event_value ke tabel reservations

ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "purchase_event_id" TEXT;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "purchase_event_value" INTEGER;
