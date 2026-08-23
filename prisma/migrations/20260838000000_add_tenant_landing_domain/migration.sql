-- AlterTable
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "landing_domain" TEXT DEFAULT '';
