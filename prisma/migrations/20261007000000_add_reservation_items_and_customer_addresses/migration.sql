-- Migration: Add ReservationItem and CustomerAddress (Fase 3A)
-- Non-destruktif & aditif: hanya menambah tabel dan kolom baru.

-- 1. Tabel reservation_items (1NF item layanan multi-sesi / multi-treatment)
CREATE TABLE IF NOT EXISTS "reservation_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "reservation_id" TEXT NOT NULL,
    "service_id" TEXT,
    "custom_name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "duration_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_items_pkey" PRIMARY KEY ("id")
);

-- 2. Tabel customer_addresses (Buku alamat relasional pelanggan multi-rumah)
CREATE TABLE IF NOT EXISTS "customer_addresses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "customer_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "kelurahan" TEXT,
    "kecamatan" TEXT,
    "kota" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "distance_km" DOUBLE PRECISION,
    "ongkir" INTEGER,
    "landmark" TEXT,
    "location_source" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- 3. Kolom relasi customer_address_id pada tabel reservations
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "customer_address_id" TEXT;

-- 4. Indeks penunjang kinerja query
CREATE INDEX IF NOT EXISTS "reservation_items_tenant_id_reservation_id_idx" ON "reservation_items"("tenant_id", "reservation_id");
CREATE INDEX IF NOT EXISTS "reservation_items_service_id_idx" ON "reservation_items"("service_id");
CREATE INDEX IF NOT EXISTS "customer_addresses_tenant_id_customer_id_idx" ON "customer_addresses"("tenant_id", "customer_id");
CREATE INDEX IF NOT EXISTS "reservations_customer_address_id_idx" ON "reservations"("customer_address_id");

-- 5. Foreign Key Constraints (Idempoten via DO block)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservation_items_reservation_id_fkey'
  ) THEN
    ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservation_items_service_id_fkey'
  ) THEN
    ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "clinic_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_addresses_customer_id_fkey'
  ) THEN
    ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_customer_address_id_fkey'
  ) THEN
    ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customer_address_id_fkey" FOREIGN KEY ("customer_address_id") REFERENCES "customer_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
