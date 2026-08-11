-- AlterTable: kolom flag label chat (Task: event-driven label sync)
-- is_admin_labeled / is_hold_labeled mencatat status label 'admin' & 'hold'
-- di WhatsApp Business, di-update oleh webhook event label.chat.added/deleted
-- (safety-net: LabelReconciliationService). Default false.
ALTER TABLE "customers" ADD COLUMN "is_admin_labeled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "is_hold_labeled" BOOLEAN NOT NULL DEFAULT false;
