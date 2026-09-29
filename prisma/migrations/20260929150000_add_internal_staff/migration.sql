-- Mandat In-System PWA Only — Fase 4: tandai nomor WhatsApp staf internal.
-- Percakapan koordinasi CS/Bidan via nomor resmi klinik BUKAN pelanggan: tidak boleh
-- memicu MQL, follow-up, CAPI, atau push CRM (admin/staf). Berbeda dari is_sandbox_test
-- (label QA test yang dihapus oleh sandbox cleanup).
-- Idempoten-safe: ADD COLUMN IF NOT EXISTS + backfill berbasis normalisasi digit.

-- AlterTable: customers — flag staf internal
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "is_internal_staff" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customers_tenant_id_is_internal_staff_idx" ON "customers"("tenant_id", "is_internal_staff");

-- Backfill: tandai customer yang nomornya cocok dengan Staff.phone tenant yang sama.
-- Normalisasi digit kanonik (selaras customer.service/notification-delivery): buang
-- non-digit, lalu awalan '0'/'8' → '62'. Kedua sisi dinormalisasi agar format 08xx,
-- 628xx, +62 8xx, dan 8xx semuanya cocok.
WITH normalized AS (
  SELECT
    c."id" AS customer_id,
    c."tenant_id",
    CASE
      WHEN regexp_replace(c."phone", '\D', '', 'g') LIKE '0%'
        THEN '62' || substr(regexp_replace(c."phone", '\D', '', 'g'), 2)
      WHEN regexp_replace(c."phone", '\D', '', 'g') LIKE '8%'
        THEN '62' || regexp_replace(c."phone", '\D', '', 'g')
      ELSE regexp_replace(c."phone", '\D', '', 'g')
    END AS cust_norm
  FROM "customers" c
  WHERE c."phone" IS NOT NULL AND c."phone" <> ''
),
staff_norm AS (
  SELECT
    s."tenant_id",
    CASE
      WHEN regexp_replace(s."phone", '\D', '', 'g') LIKE '0%'
        THEN '62' || substr(regexp_replace(s."phone", '\D', '', 'g'), 2)
      WHEN regexp_replace(s."phone", '\D', '', 'g') LIKE '8%'
        THEN '62' || regexp_replace(s."phone", '\D', '', 'g')
      ELSE regexp_replace(s."phone", '\D', '', 'g')
    END AS staff_norm
  FROM "staff" s
  WHERE s."phone" IS NOT NULL AND s."phone" <> ''
)
UPDATE "customers" c
SET "is_internal_staff" = true
FROM normalized n
JOIN staff_norm sn
  ON sn."tenant_id" = n."tenant_id" AND sn."staff_norm" = n."cust_norm"
WHERE c."id" = n."customer_id";
