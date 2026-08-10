-- AlterTable
ALTER TABLE "llm_audit_logs" ADD COLUMN "cached_prompt_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "error_code" TEXT,
ADD COLUMN "eval_run" TEXT,
ADD COLUMN "latency_ms" INTEGER,
ADD COLUMN "provider" TEXT;