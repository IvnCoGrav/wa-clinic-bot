-- DropIndex
DROP INDEX IF EXISTS "messages_wa_message_id_key";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "messages_tenant_id_wa_message_id_key" ON "messages"("tenant_id", "wa_message_id");
