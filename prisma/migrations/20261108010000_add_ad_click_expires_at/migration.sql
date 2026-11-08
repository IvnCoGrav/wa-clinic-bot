-- AlterTable
ALTER TABLE "ad_clicks" ADD COLUMN "expires_at" TIMESTAMP(3);

-- Backfill existing rows with 7 days from created_at
UPDATE "ad_clicks" SET "expires_at" = "created_at" + INTERVAL '7 days' WHERE "expires_at" IS NULL;

-- CreateIndex
CREATE INDEX "ad_clicks_expires_at_idx" ON "ad_clicks"("expires_at");

-- CreateTable cron_leases
CREATE TABLE IF NOT EXISTS "cron_leases" (
    "job_name" TEXT NOT NULL,
    "holder_id" TEXT NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_leases_pkey" PRIMARY KEY ("job_name")
);

