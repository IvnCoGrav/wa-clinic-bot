-- AlterTable: Add transit timestamps for field therapists
ALTER TABLE "reservations" ADD COLUMN "otw_sent_at" TIMESTAMP(3);
ALTER TABLE "reservations" ADD COLUMN "arrived_at" TIMESTAMP(3);
