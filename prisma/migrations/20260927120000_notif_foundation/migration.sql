-- Fase 1r: Fondasi notifikasi admin (AdminNotificationLog) + field LiveChat
-- (Customer.admin_notes, Conversation.is_frustrated) + config Nightly Watchdog di Tenant.
-- Idempoten-safe: ADD COLUMN / CREATE TABLE IF NOT EXISTS agar aman di live.

-- AlterTable: conversations — pulse alert kekecewaan (state/SLA-based)
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "frustrated_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "frustrated_reason" TEXT,
ADD COLUMN IF NOT EXISTS "is_frustrated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: customers — sticky memory note antar-shift
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "admin_notes" TEXT,
ADD COLUMN IF NOT EXISTS "notes_updated_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "notes_updated_by" TEXT;

-- AlterTable: tenants — konfigurasi Nightly Watchdog (default OFF)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "admin_whatsapp_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "nightly_report_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "nightly_report_hour" INTEGER NOT NULL DEFAULT 21,
ADD COLUMN IF NOT EXISTS "nightly_report_minute" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "notification_channels" TEXT[] DEFAULT ARRAY['TELEGRAM']::TEXT[];

-- CreateTable: log notifikasi admin generik (sumber idempotensi cron)
CREATE TABLE IF NOT EXISTS "admin_notification_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "report_date" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "title" TEXT NOT NULL,
    "message_content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "error_message" TEXT,
    "metadata" JSONB,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "admin_notification_logs_idempotency_key_key" ON "admin_notification_logs"("idempotency_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admin_notification_logs_tenant_id_sent_at_idx" ON "admin_notification_logs"("tenant_id", "sent_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admin_notification_logs_tenant_id_notification_type_idx" ON "admin_notification_logs"("tenant_id", "notification_type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_tenant_id_is_frustrated_last_message_at_idx" ON "conversations"("tenant_id", "is_frustrated", "last_message_at");
