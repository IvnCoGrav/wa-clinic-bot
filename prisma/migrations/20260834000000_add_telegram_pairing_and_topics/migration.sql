-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "telegram_pairing_token" TEXT,
ADD COLUMN "telegram_topic_daily_report" TEXT,
ADD COLUMN "telegram_topic_system_errors" TEXT,
ADD COLUMN "telegram_topic_medical_alerts" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tenants_telegram_pairing_token_key" ON "tenants"("telegram_pairing_token");
