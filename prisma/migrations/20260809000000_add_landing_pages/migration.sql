-- CreateTable
CREATE TABLE "landing_pages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "landing_type" "LandingType" NOT NULL DEFAULT 'RAW_HTML',
    "html_content" TEXT,
    "structured_content" JSONB,
    "meta_pixel_id" TEXT,
    "whatsapp_number" TEXT,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id")
);

-- Migrasi legacy: landing tenant (STRUCTURED_JSON / RAW_HTML) menjadi LandingPage pertama.
-- Idempotent: hanya tenant yang belum punya landing page dengan slug yang sama.
INSERT INTO "landing_pages" ("id", "tenant_id", "slug", "title", "landing_type", "html_content", "structured_content", "meta_pixel_id", "whatsapp_number", "events", "is_active", "created_at", "updated_at")
SELECT
    gen_random_uuid()::text,
    t."id",
    t."slug",
    t."name",
    t."landing_type",
    t."raw_html_content",
    t."landing_content",
    t."meta_pixel_id",
    t."whatsapp_number",
    ARRAY[]::TEXT[],
    true,
    now(),
    now()
FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "landing_pages" lp WHERE lp."slug" = t."slug");

-- CreateIndex
CREATE INDEX "landing_pages_tenant_id_idx" ON "landing_pages"("tenant_id");
