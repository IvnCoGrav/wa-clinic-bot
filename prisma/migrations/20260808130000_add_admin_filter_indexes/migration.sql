-- 2026-08-08 · Production Performance Audit (P6)
-- Index kolom filter yang sering dipakai query admin dashboard & state-machine,
--   agar pola akses tidak jadi slow saat data meningkatkan.
-- Nama index mengikuti konvensi Prisma (@@index tanpa map) supaya
--   `prisma migrate diff --from-url ... --to-schema-datamodel` tetap kosong.
-- Ukuran data kecil → CREATE INDEX instan tanpa downtime.

-- Conversation: list unresolved_faq / review-flagged
CREATE INDEX "conversations_tenant_id_escalation_reason_idx" ON "conversations"("tenant_id", "escalation_reason");
CREATE INDEX "conversations_tenant_id_review_flagged_idx" ON "conversations"("tenant_id", "review_flagged");

-- Reservation: detail customer & filter status (dashboard/cron)
CREATE INDEX "reservations_customer_id_idx" ON "reservations"("customer_id");
CREATE INDEX "reservations_customer_id_status_idx" ON "reservations"("customer_id", "status");