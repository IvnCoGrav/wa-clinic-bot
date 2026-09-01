-- CreateTable: ReservationSeries
CREATE TABLE "reservation_series" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "customer_id" TEXT NOT NULL,
    "treatment_name" TEXT NOT NULL,
    "total_sessions" INTEGER NOT NULL,
    "purchase_value" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "assigned_staff_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservation_series_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Add series fields to reservations
ALTER TABLE "reservations" ADD COLUMN "series_id" TEXT;
ALTER TABLE "reservations" ADD COLUMN "session_number" INTEGER;
ALTER TABLE "reservations" ADD COLUMN "total_sessions" INTEGER;

-- AlterTable: Add multi-session fields to clinic_services
ALTER TABLE "clinic_services" ADD COLUMN "total_sessions" INTEGER;
ALTER TABLE "clinic_services" ADD COLUMN "session_schedule_type" TEXT;

-- Add foreign key
ALTER TABLE "reservation_series" ADD CONSTRAINT "reservation_series_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reservation_series" ADD CONSTRAINT "reservation_series_assigned_staff_id_fkey" FOREIGN KEY ("assigned_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "reservation_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "reservation_series_tenant_id_customer_id_idx" ON "reservation_series"("tenant_id", "customer_id");
CREATE INDEX "reservation_series_tenant_id_status_idx" ON "reservation_series"("tenant_id", "status");
CREATE INDEX "reservations_series_id_idx" ON "reservations"("series_id");
