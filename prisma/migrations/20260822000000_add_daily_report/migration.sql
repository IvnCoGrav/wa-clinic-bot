-- Fitur Laporan Operasional Harian (Daily Ops Report) dikirim ke Telegram.
-- Kolom konfigurasi per-tenant + tabel log pengiriman harian.
-- Null pada telegram_* berarti memakai fallback env TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "daily_report_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN "daily_report_hour" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "tenants" ADD COLUMN "telegram_bot_token" TEXT;
ALTER TABLE "tenants" ADD COLUMN "telegram_chat_id" TEXT;

-- CreateTable
CREATE TABLE "daily_report_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "report_date" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "metadata" JSONB,

    CONSTRAINT "daily_report_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_report_logs_tenant_id_report_date_key" ON "daily_report_logs"("tenant_id", "report_date");

-- CreateIndex
CREATE INDEX "daily_report_logs_tenant_id_idx" ON "daily_report_logs"("tenant_id");
