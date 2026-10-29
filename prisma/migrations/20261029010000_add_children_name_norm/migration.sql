-- Migration: 20261029010000_add_children_name_norm
-- Identitas anak atomik dengan name_norm (case-insensitive dedup) dan preservasi first/last reservation (A-006)

ALTER TABLE "children" ADD COLUMN IF NOT EXISTS "name_norm" TEXT;
ALTER TABLE "children" ADD COLUMN IF NOT EXISTS "first_reservation_id" TEXT;
ALTER TABLE "children" ADD COLUMN IF NOT EXISTS "last_reservation_id" TEXT;

UPDATE "children" SET "name_norm" = lower(btrim("name")) WHERE "name_norm" IS NULL;
UPDATE "children" SET "first_reservation_id" = "reservation_id" WHERE "first_reservation_id" IS NULL;

ALTER TABLE "children" ALTER COLUMN "name_norm" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "children_customer_id_name_norm_key" ON "children"("customer_id", "name_norm");
