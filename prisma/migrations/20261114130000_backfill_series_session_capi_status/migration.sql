-- Backfill purchase_review_status = 'not_applicable' untuk sesi reservasi berseri non-anchor (sesi > 1)
-- Tujuan: single-anchor CAPI — hanya sesi 1 paket yang membawa event komersial Purchase.
UPDATE "reservations"
SET "purchase_review_status" = 'not_applicable'
WHERE "series_id" IS NOT NULL
  AND "session_number" > 1
  AND "purchase_review_status" = 'pending';
