-- Fase 2 (issue #135): PageView eventID/source/referrer + dedup + fix drift ad_clicks.
-- Dibuat manual (bukan `migrate dev`) karena shadow replay rusak oleh urutan enum
-- FollowUpStatus di 20260801000000 (known trap AGENTS.md). Verifikasi via:
--   npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
-- Semua statement idempoten (IF NOT EXISTS / guarded) agar aman di DB live.

-- 1. Kolom baru landing_page_views -------------------------------------------
ALTER TABLE "landing_page_views" ADD COLUMN IF NOT EXISTS "eventId" TEXT;
ALTER TABLE "landing_page_views" ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'beacon';
ALTER TABLE "landing_page_views" ADD COLUMN IF NOT EXISTS "referrer" TEXT;

-- 2. UNIQUE eventID (dedup beacon: retry/klien ganda tidak menggandakan baris).
--    Postgres UNIQUE mengizinkan banyak NULL → baris historis/backfill aman.
CREATE UNIQUE INDEX IF NOT EXISTS "landing_page_views_eventId_key" ON "landing_page_views"("eventId");

-- 3. Index filter dashboard (meta-summary meng-filters utmCampaign per tenant).
--    Nama mengikuti konvensi Prisma: nama TABEL (bukan nama model).
CREATE INDEX IF NOT EXISTS "landing_page_views_tenant_id_utmCampaign_idx" ON "landing_page_views"("tenant_id", "utmCampaign");

-- 4. Tandai baris synthetic hasil backfill manual (literal UA dari script) ---
UPDATE "landing_page_views"
SET "source" = 'backfill-synthetic'
WHERE "userAgent" = 'Mozilla/5.0 (backfill synthetic)'
  AND ("source" IS NULL OR "source" = 'beacon');

-- 5. Drift fix: ad_clicks tidak pernah punya CREATE TABLE (migrasi lama hanya
--    ALTER ctwa_clid). IF NOT EXISTS = no-op di DB live; menyelamatkan fresh deploy.
CREATE TABLE IF NOT EXISTS "ad_clicks" (
    "id" TEXT NOT NULL,
    "trackingCode" TEXT,
    "fbclid" TEXT,
    "fbp" TEXT,
    "fbc" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "landingUrl" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "ctwa_clid" TEXT,
    "phone" TEXT,
    "matchedAt" TIMESTAMP(3),
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "ad_clicks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ad_clicks_trackingCode_key" ON "ad_clicks"("trackingCode");
CREATE UNIQUE INDEX IF NOT EXISTS "ad_clicks_customerId_key" ON "ad_clicks"("customerId");
CREATE INDEX IF NOT EXISTS "ad_clicks_tenant_id_idx" ON "ad_clicks"("tenant_id");
CREATE INDEX IF NOT EXISTS "ad_clicks_trackingCode_idx" ON "ad_clicks"("trackingCode");

DO $$ BEGIN
    ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_customerId_fkey"
        FOREIGN KEY ("customerId") REFERENCES "customers"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
