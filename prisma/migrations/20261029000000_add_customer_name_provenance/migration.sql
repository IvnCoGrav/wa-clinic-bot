-- AlterTable
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "name_source" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "whatsapp_push_name" TEXT;
