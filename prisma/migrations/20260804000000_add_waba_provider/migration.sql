-- WABA Integration Phase 3: Multi-tenant WhatsApp provider config + Marketing Opt-in
-- Adds:
--   enum "WhatsappProvider" (WAHA | WABA)
--   tenants.whatsapp_provider, waha_session_id, waba_phone_number_id,
--   waba_business_account_id, waba_access_token, waba_webhook_verify_token
--   customers.marketing_opt_in, marketing_opt_in_at, marketing_opt_in_source

-- CreateEnum
CREATE TYPE "WhatsappProvider" AS ENUM ('WAHA', 'WABA');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "whatsapp_provider" "WhatsappProvider" NOT NULL DEFAULT 'WAHA';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "waha_session_id" TEXT DEFAULT 'default';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "waba_phone_number_id" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "waba_business_account_id" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "waba_access_token" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "waba_webhook_verify_token" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "marketing_opt_in_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "marketing_opt_in_source" TEXT;
