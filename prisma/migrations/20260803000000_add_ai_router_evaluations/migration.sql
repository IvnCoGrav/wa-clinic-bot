-- RUNBOOK REFERENCE (2026-08-02):
-- Sebelum deploy, lihat README "Deployment & Runbook Migration".
-- - Jika `children` sudah ada tapi `migrate deploy` error "relation children already exists":
--   npx prisma migrate resolve --applied 20260802000000_add_children  (lihat file migration add_children)
-- - `migrate diff --from-migrations` (shadow replay) RUSAK oleh bug enum FollowUpStatus
--   di migration add_failed_followup_status -> gunakan `migrate diff --from-url`.
-- Tabel ini dipakai fitur AI Router observability: log shadow/full evaluation,
-- query akurasi lewat `npx tsx src/scripts/check-router-accuracy.ts`.

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "consecutive_unknown_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ai_router_evaluations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "customer_phone" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "current_state" TEXT NOT NULL,
    "llm_raw_output" JSONB,
    "llm_intent" TEXT,
    "llm_confidence" DOUBLE PRECISION,
    "llm_used_fallback" BOOLEAN NOT NULL DEFAULT false,
    "legacy_intent" TEXT NOT NULL,
    "legacy_escalated" BOOLEAN NOT NULL,
    "intent_match" BOOLEAN NOT NULL,
    "escalation_match" BOOLEAN NOT NULL,
    "mismatch_notes" TEXT,
    "response_time_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_router_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_router_evaluations_tenant_id_created_at_idx" ON "ai_router_evaluations"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_router_evaluations_intent_match_idx" ON "ai_router_evaluations"("intent_match");

-- CreateIndex
CREATE INDEX "ai_router_evaluations_escalation_match_idx" ON "ai_router_evaluations"("escalation_match");
