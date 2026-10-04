-- CTWA Greeting Catcher (tenant-aware): pemetaan kalimat pembuka iklan
-- Click-to-WhatsApp ke nama kampanye saat metadata referral Meta hilang.
-- IF NOT EXISTS = idempoten / no-op bila tabel sudah ada di DB live.
CREATE TABLE IF NOT EXISTS "ctwa_campaign_catchers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "campaign_name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'instagram',
    "medium" TEXT NOT NULL DEFAULT 'ctwa',
    "greetings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "anchor_keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "similarity_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.70,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ctwa_campaign_catchers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ctwa_campaign_catchers_tenant_id_is_active_idx" ON "ctwa_campaign_catchers"("tenant_id", "is_active");
