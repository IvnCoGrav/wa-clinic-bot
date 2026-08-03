-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "sender_name" TEXT,
ADD COLUMN     "sender_type" TEXT DEFAULT 'BOT';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "manual_reply_escalates" BOOLEAN NOT NULL DEFAULT true;
