-- AlterTable
ALTER TABLE "quick_replies" ADD COLUMN IF NOT EXISTS "media_type" TEXT DEFAULT 'NONE';
ALTER TABLE "quick_replies" ADD COLUMN IF NOT EXISTS "image_url" TEXT;
