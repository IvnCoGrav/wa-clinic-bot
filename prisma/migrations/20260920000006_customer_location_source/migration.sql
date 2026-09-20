-- Add LocationSource enum + customers.location_source column.
-- Sumber koordinat lokasi customer untuk pembeda visual di peta sebaran:
--   gps_pin (pin GPS asli), estimated_area (estimasi wilayah), manual_staff (edit bidan/staf).
-- Nullable: data lama tetap NULL hingga jalur tulis relevan di-update.

-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('gps_pin', 'estimated_area', 'manual_staff');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "location_source" "LocationSource";
