-- Menambahkan kolom media_retention_days pada tabel tenants.
-- Menentukan berapa lama file media (gambar outbound/inbound) disimpan di
-- storage/media sebelum dihapus otomatis oleh cron cleanup. Default 30 hari.
ALTER TABLE "tenants" ADD COLUMN "media_retention_days" INTEGER NOT NULL DEFAULT 30;
