ALTER TABLE "staff" ADD COLUMN "base_lat" DOUBLE PRECISION;
ALTER TABLE "staff" ADD COLUMN "base_lng" DOUBLE PRECISION;
ALTER TABLE "staff" ADD COLUMN "base_address" TEXT;
ALTER TABLE "reservations" ADD COLUMN "delay_notified_at" TIMESTAMP(3);
