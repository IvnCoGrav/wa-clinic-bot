-- D-01: Kolom closed_at dan partial unique index untuk satu percakapan aktif per (tenant_id, customer_id)
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3);

-- Indeks komposit performa query pencarian sesi aktif
CREATE INDEX IF NOT EXISTS "conversations_tenant_id_customer_id_closed_at_idx"
  ON "conversations"("tenant_id", "customer_id", "closed_at");

-- Normalisasi data eksisting: bila ada duplikat percakapan aktif (closed_at IS NULL) untuk customer & tenant yang sama,
-- tutup percakapan lama dan sisakan 1 percakapan paling mutakhir (updated_at DESC, id DESC).
WITH ranked_active AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "tenant_id", "customer_id"
           ORDER BY "updated_at" DESC, "id" DESC
         ) AS rn
  FROM "conversations"
  WHERE "closed_at" IS NULL
)
UPDATE "conversations" c
SET "closed_at" = NOW(),
    "updated_at" = NOW()
FROM ranked_active r
WHERE c."id" = r."id" AND r.rn > 1;

-- Partial unique index: hanya satu percakapan aktif (closed_at IS NULL) per tenant dan customer
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_active_unique_idx"
  ON "conversations"("tenant_id", "customer_id")
  WHERE "closed_at" IS NULL;
