-- Penundaan & moderasi event Purchase Meta CAPI (Outlier Filter Queue).
-- 1. Reservation: simpan timestamp asli pembayaran + status review moderasi.
--    - purchase_occurred_at: kapan customer mengirim pesan pembayaran.
--    - purchase_review_status: "pending" (ditahan) | "approved" | "ignored_outlier".
-- 2. Tenant: toggle auto-send CAPI. Default false = moderasi manual aktif
--    (event Purchase ditahan ke queue admin sampai di-approve/reject).
ALTER TABLE "reservations" ADD COLUMN "purchase_occurred_at" TIMESTAMP(3);
ALTER TABLE "reservations" ADD COLUMN "purchase_review_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "tenants" ADD COLUMN "auto_send_purchase_capi" BOOLEAN NOT NULL DEFAULT false;
