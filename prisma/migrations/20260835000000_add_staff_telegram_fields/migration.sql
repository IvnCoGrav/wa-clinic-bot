-- AlterTable
ALTER TABLE "staff" ADD COLUMN "telegram_chat_id" TEXT,
ADD COLUMN "telegram_pairing_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "staff_telegram_pairing_token_key" ON "staff"("telegram_pairing_token");
