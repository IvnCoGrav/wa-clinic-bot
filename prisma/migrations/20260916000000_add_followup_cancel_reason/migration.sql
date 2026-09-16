-- Cancel Reason + Event-Driven Last-Chat Sliding Window (follow_ups).
-- 1) cancel_reason: menyimpan alasan mengapa follow-up CANCELLED/SKIPPED.
-- 2) Composite index: mempercepat lookup antrian NO_PURCHASE aktif per customer
--    saat inbound chat hook (WHERE tenant_id + customer_id + type + status).
-- Idempotent: aman di DB live (kolom/index sudah ada) maupun fresh DB.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'follow_ups' AND column_name = 'cancel_reason'
  ) THEN
    ALTER TABLE "follow_ups" ADD COLUMN "cancel_reason" TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "follow_ups_tenant_id_customer_id_type_status_idx"
  ON "follow_ups"("tenant_id", "customer_id", "type", "status");
