-- Tahap 1 (Audit Follow-Up): integritas unik anti-duplikat + indeks performa.
--
-- Mengapa bukan partial index:
--   Migrasi 20260920000001 secara eksplisit memutuskan TIDAK memakai partial index
--   karena Prisma tak dapat merepresentasikannya di schema.prisma -> memicu drift
--   permanen (lihat catatan di migrasi tsb). Di sini kita pakai kolom sentinel
--   nullable `active_slot_key` + trigger, yang dapat direpresentasikan Prisma
--   (kolom + @@unique) sehingga drift tetap nol.
--
-- Semantik: follow-up AKTIF (PENDING/QUEUED) unik per (tenant, customer, type, stage).
-- Baris non-aktif (SENT/CANCELLED/SKIPPED/FAILED) punya active_slot_key = NULL,
-- sehingga PostgreSQL (NULL dianggap berbeda) mengizinkan banyak baris historis.

-- (1) Tambah kolom sentinel.
ALTER TABLE "follow_ups" ADD COLUMN IF NOT EXISTS "active_slot_key" TEXT;

-- (2) Normalisasi data live: batalkan baris ganda aktif, sisakan satu (terlama,
--     tie-break id ASC). Baris TIDAK dihapus -> menjadi jejak historis.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "tenant_id", "customer_id", "type", "stage"
           ORDER BY "created_at" ASC, "id" ASC
         ) AS rn
  FROM "follow_ups"
  WHERE "status" IN ('PENDING', 'QUEUED')
)
UPDATE "follow_ups" f
SET "status" = 'CANCELLED',
    "cancel_reason" = 'DEDUP_CLEANUP',
    "updated_at" = NOW()
FROM ranked r
WHERE f."id" = r."id" AND r.rn > 1;

-- (3) Backfill sentinel untuk baris aktif yang tersisa.
UPDATE "follow_ups"
SET "active_slot_key" = "customer_id"
WHERE "status" IN ('PENDING', 'QUEUED');

-- (4) Hapus unique lama (berbasis reservation_id NULL -> tidak melindungi).
DROP INDEX IF EXISTS "follow_ups_tenant_id_reservation_id_type_stage_key";

-- (5) Unique baru berbasis sentinel (Prisma-representable).
CREATE UNIQUE INDEX IF NOT EXISTS "follow_ups_tenant_id_active_slot_key_type_stage_key"
  ON "follow_ups" ("tenant_id", "active_slot_key", "type", "stage");

-- (6) Trigger penjaga sentinel (deterministik di level DB; tak terdeteksi Prisma).
CREATE OR REPLACE FUNCTION "follow_ups_sync_active_slot_key"()
RETURNS trigger AS $$
BEGIN
  IF NEW."status" IN ('PENDING', 'QUEUED') THEN
    NEW."active_slot_key" := NEW."customer_id";
  ELSE
    NEW."active_slot_key" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "follow_ups_active_slot_key_trg" ON "follow_ups";
CREATE TRIGGER "follow_ups_active_slot_key_trg"
  BEFORE INSERT OR UPDATE OF "status", "customer_id" ON "follow_ups"
  FOR EACH ROW EXECUTE FUNCTION "follow_ups_sync_active_slot_key"();

-- (7) Indeks komposit penunjang kinerja worker (anti Seq Scan).
CREATE INDEX IF NOT EXISTS "follow_ups_tenant_id_status_scheduled_at_idx"
  ON "follow_ups" ("tenant_id", "status", "scheduled_at");

CREATE INDEX IF NOT EXISTS "customers_tenant_id_deleted_at_status_idx"
  ON "customers" ("tenant_id", "deleted_at", "status");

-- (8) Tahap 3 (V5/H3): kolom lease klaim pengiriman anti dobel-kirim.
--     Diisi atomik oleh worker/sendNow saat mulai mengirim; NULL saat idle.
ALTER TABLE "follow_ups" ADD COLUMN IF NOT EXISTS "processing_claimed_at" TIMESTAMP(3);

