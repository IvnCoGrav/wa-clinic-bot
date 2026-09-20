-- Stage 4 (RC-02): state episodik V3 per-conversation.
ALTER TABLE "conversations" ADD COLUMN "session_data" JSONB;
