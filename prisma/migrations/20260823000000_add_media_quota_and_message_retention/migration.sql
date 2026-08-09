-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "media_quota_bytes" INTEGER NOT NULL DEFAULT 209715200;
ALTER TABLE "tenants" ADD COLUMN "message_retention_days" INTEGER NOT NULL DEFAULT 120;
