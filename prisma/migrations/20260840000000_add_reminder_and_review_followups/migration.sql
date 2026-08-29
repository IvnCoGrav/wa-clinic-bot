-- AlterEnum
ALTER TYPE "FollowUpType" ADD VALUE IF NOT EXISTS 'REMINDER_H1';
ALTER TYPE "FollowUpType" ADD VALUE IF NOT EXISTS 'REVIEW_H1_BABY';
ALTER TYPE "FollowUpType" ADD VALUE IF NOT EXISTS 'REVIEW_H1_MOMS';

-- AlterTable
ALTER TABLE "follow_ups" ADD COLUMN IF NOT EXISTS "reservation_id" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "follow_ups_reservation_id_idx" ON "follow_ups"("reservation_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_reservation_id_fkey'
    ) THEN
        ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
