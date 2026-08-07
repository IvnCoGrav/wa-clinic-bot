-- Add AiEvaluation table (LLM-as-Judge quality scoring, separate from router accuracy table)
CREATE TABLE "ai_evaluations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "message_id" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "conversation_id" TEXT,
    "message_text" TEXT NOT NULL,
    "ai_reasoning" TEXT,
    "score" INTEGER,
    "feedback" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evaluations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_evaluations_message_id_key" ON "ai_evaluations"("message_id");
CREATE INDEX "ai_evaluations_tenant_id_created_at_idx" ON "ai_evaluations"("tenant_id", "created_at");