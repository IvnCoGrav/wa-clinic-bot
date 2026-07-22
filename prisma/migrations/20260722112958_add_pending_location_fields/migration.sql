-- CreateEnum
CREATE TYPE "TreatmentCategory" AS ENUM ('BABY', 'MOMS', 'BOTH');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "pending_kecamatan" TEXT,
ADD COLUMN     "pending_kelurahan" TEXT,
ADD COLUMN     "pending_kota" TEXT,
ADD COLUMN     "pending_lat" DOUBLE PRECISION,
ADD COLUMN     "pending_lng" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "treatment_category" "TreatmentCategory" NOT NULL,
    "treatment_detail" TEXT,
    "booking_date" TIMESTAMP(3),
    "raw_text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
