-- AlterTable
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "profile_picture_url" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "profile_picture_updated_at" TIMESTAMP(3);
