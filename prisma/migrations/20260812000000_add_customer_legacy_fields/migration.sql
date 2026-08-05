-- Add legacy source fields to customers table (additive, default false / nullable)
ALTER TABLE "customers" ADD COLUMN "is_legacy_source" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN "legacy_scraped_at" TIMESTAMP(3);