-- Menambahkan kolom pricelist_image_url pada tabel tenants.
-- URL/sumber gambar pricelist per-tenant (bisa URL publik, path file lokal,
-- atau relative /media/outbound/...). Null berarti memakai fallback env
-- CLINIC_PRICELIST_IMAGE_URL atau aset default assets/pricelist_spa.jpg.
ALTER TABLE "tenants" ADD COLUMN "pricelist_image_url" TEXT;
