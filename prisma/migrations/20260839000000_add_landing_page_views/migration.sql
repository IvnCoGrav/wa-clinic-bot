-- CreateTable
CREATE TABLE IF NOT EXISTS "landing_page_views" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "landingUrl" TEXT,
    "fbclid" TEXT,
    "fbp" TEXT,
    "fbc" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "utmId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LandingPageView_tenant_id_idx" ON "landing_page_views"("tenant_id");
CREATE INDEX IF NOT EXISTS "LandingPageView_tenant_id_createdAt_idx" ON "landing_page_views"("tenant_id", "createdAt");
