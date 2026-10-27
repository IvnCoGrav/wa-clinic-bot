-- Migration: add_reservation_series_billing
-- Menambahkan kolom komersial/billing ke reservation_series (Unit Komersial Tunggal)

-- 1. AlterTable: Tambah kolom komersial & alamat ke reservation_series
ALTER TABLE "reservation_series" ADD COLUMN IF NOT EXISTS "delivery_fee" INTEGER;
ALTER TABLE "reservation_series" ADD COLUMN IF NOT EXISTS "discount_amount" INTEGER;
ALTER TABLE "reservation_series" ADD COLUMN IF NOT EXISTS "payment_method" TEXT;
ALTER TABLE "reservation_series" ADD COLUMN IF NOT EXISTS "duration_minutes" INTEGER;
ALTER TABLE "reservation_series" ADD COLUMN IF NOT EXISTS "customer_address_id" TEXT;
ALTER TABLE "reservation_series" ADD COLUMN IF NOT EXISTS "request_id" TEXT;

-- 2. CreateIndex: Unik per tenant untuk request_id (idempotensi) & indeks customer_address_id
CREATE UNIQUE INDEX IF NOT EXISTS "reservation_series_tenant_id_request_id_key" ON "reservation_series"("tenant_id", "request_id");
CREATE INDEX IF NOT EXISTS "reservation_series_customer_address_id_idx" ON "reservation_series"("customer_address_id");

-- 3. AddForeignKey: Hubungkan customer_address_id ke customer_addresses
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'reservation_series_customer_address_id_fkey'
    ) THEN
        ALTER TABLE "reservation_series" ADD CONSTRAINT "reservation_series_customer_address_id_fkey" FOREIGN KEY ("customer_address_id") REFERENCES "customer_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
