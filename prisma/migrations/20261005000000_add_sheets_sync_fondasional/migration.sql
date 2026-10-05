-- Google Sheets rekapan (fondasional, SaaS-ready): config per-tenant + outbox antrean.
-- Idempoten (IF NOT EXISTS) agar aman di DB live maupun fresh env.

-- 1. Konfigurasi rekapan per-tenant (nama file, 12 tab bulan, ID file/tahun).
CREATE TABLE IF NOT EXISTS "tenant_sheets_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "file_base_name" TEXT NOT NULL DEFAULT 'Rekapan Pasien',
    "master_spreadsheet_id" TEXT,
    "drive_folder_id" TEXT,
    "yearly_file_ids" JSONB,
    "month_tab_names" TEXT[] NOT NULL DEFAULT ARRAY['Jan','Feb','Mar','April','Mei','Juni','Juli','Aug','Sept','okt','Nov','Des']::TEXT[],
    "template_sheet_name" TEXT NOT NULL DEFAULT '_TEMPLATE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_sheets_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_sheets_configs_tenant_id_key" ON "tenant_sheets_configs"("tenant_id");
CREATE INDEX IF NOT EXISTS "tenant_sheets_configs_tenant_id_idx" ON "tenant_sheets_configs"("tenant_id");

-- 2. Outbox sinkronisasi: webhook hanya menulis 1 baris di sini (non-blocking).
CREATE TABLE IF NOT EXISTS "sheets_sync_outbox" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "reservation_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL DEFAULT 'UPSERT',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sheets_sync_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sheets_sync_outbox_tenant_id_reservation_id_key" ON "sheets_sync_outbox"("tenant_id", "reservation_id");
CREATE INDEX IF NOT EXISTS "sheets_sync_outbox_tenant_id_status_next_retry_at_idx" ON "sheets_sync_outbox"("tenant_id", "status", "next_retry_at");

-- 3. Kolom cermin Sheets + diskon di reservations.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "discount_amount" INTEGER;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "sheets_spreadsheet_id" TEXT;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "sheets_tab_name" TEXT;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "sheets_row_index" INTEGER;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "sheets_synced_at" TIMESTAMP(3);
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "sheets_sync_status" TEXT NOT NULL DEFAULT 'pending';

-- 4. Seed config untuk default-tenant (ID file dari user; admin dapat mengubahnya).
--    is_enabled=false sampai Google disambungkan ulang dengan scope baru.
INSERT INTO "tenant_sheets_configs" (
    "id", "tenant_id", "is_enabled", "master_spreadsheet_id", "yearly_file_ids", "created_at", "updated_at"
)
VALUES (
    'a0000000-0000-4000-8000-000000000001',
    'default-tenant',
    false,
    '1J-WFpaTZbCZs3WIFqBddAg6tl4G6CX7pg0S_xvudK7o',
    '{"2026":"1J-WFpaTZbCZs3WIFqBddAg6tl4G6CX7pg0S_xvudK7o"}'::JSONB,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("tenant_id") DO NOTHING;
