-- Stage 7 (Audit R6): idempotency & follow-up uniqueness.
-- (1) reservations.request_id per-tenant unique — cegah baris ganda dari retry/concurrency.
-- (2) follow_ups unique (tenant_id, reservation_id, type, stage) — cegah reminder/review ganda.
--
-- Normalisasi data (2026-09-20, temuan produksi): follow-up yang sudah CANCELLED
-- lalu dibuat ulang meninggalkan >1 baris untuk (reservation_id, type, stage) yang sama.
-- Baris CANCELLED adalah jejak historis dan tidak lagi terkait reservasi aktif, jadi
-- `reservation_id`-nya dinetralkan ke NULL (baris TIDAK dihapus). PostgreSQL menganggap
-- NULL unik, sehingga unique index penuh di bawah tetap valid tanpa partial index
-- (partial index tak dapat direpresentasikan di schema.prisma → memicu drift permanen).

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "request_id" TEXT;

-- DataNormalization: netralkan reservation_id pada follow-up CANCELLED yang duplikat
UPDATE "follow_ups" f
SET "reservation_id" = NULL
WHERE f."status" = 'CANCELLED'
  AND f."reservation_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "follow_ups" g
    WHERE g."tenant_id" = f."tenant_id"
      AND g."reservation_id" = f."reservation_id"
      AND g."type" = f."type"
      AND g."stage" = f."stage"
      AND g."id" <> f."id"
  );

-- CreateIndex
CREATE UNIQUE INDEX "follow_ups_tenant_id_reservation_id_type_stage_key" ON "follow_ups"("tenant_id", "reservation_id", "type", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_tenant_id_request_id_key" ON "reservations"("tenant_id", "request_id");
