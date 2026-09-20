-- Stage 7 (Audit R6): idempotency & follow-up uniqueness.
-- (1) reservations.request_id per-tenant unique — cegah baris ganda dari retry/concurrency.
-- (2) follow_ups unique (tenant_id, reservation_id, type, stage) — cegah reminder/review ganda.
-- Prasyarat terverifikasi (read-only 2026-09-20): 0 duplikat follow-up; drift empty.

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "request_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "follow_ups_tenant_id_reservation_id_type_stage_key" ON "follow_ups"("tenant_id", "reservation_id", "type", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_tenant_id_request_id_key" ON "reservations"("tenant_id", "request_id");
