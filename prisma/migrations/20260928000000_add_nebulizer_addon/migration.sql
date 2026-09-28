-- KNOWN_ISSUES #156: pastikan ADD-ON Nebulizer (Saline & +Obat) tersedia di katalog
-- tenant default. Nebulizer adalah add-on resmi (dipadukan dengan layanan utama
-- pijat terapi, TIDAK berdiri sendiri). Idempoten (ON CONFLICT DO NOTHING) +
-- per-tenant default-tenant; tidak menimpa harga/kustomisasi admin yang sudah ada.
--
-- Sumber nilai: scripts/sync-updated-pricelist.ts (pricelist kanonik rebrand Kala)
-- dan services_custom.json. Harga/tier WAJIB dikonfirmasi Bidan — ubah via
-- dashboard admin, BUKAN migrasi baru.
--
-- Rollback jujur: UPDATE clinic_services SET is_active=false
--   WHERE service_id IN ('add-on-nebulizer','add-on-nebulizer-obat');

INSERT INTO clinic_services
  (id, tenant_id, service_id, name, category, min_age_months, max_age_months, age_label,
   duration_minutes, original_price, promo_price, description, is_active, sort_order,
   created_at, updated_at)
SELECT
  gen_random_uuid(), 'default-tenant', 'add-on-nebulizer',
  'Kala Terapi – Nebulizer Saline', 'ADD_ON', 0, NULL, 'Bayi & Anak',
  20, 45000, 35000,
  '[ADDON] Terapi uap inhalasi/penguapan dengan cairan saline steril untuk mengencerkan lendir dan dahak.',
  true,
  COALESCE((SELECT MAX(sort_order) + 1 FROM clinic_services WHERE tenant_id = 'default-tenant'), 0),
  NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM clinic_services
  WHERE tenant_id = 'default-tenant' AND service_id = 'add-on-nebulizer'
);

INSERT INTO clinic_services
  (id, tenant_id, service_id, name, category, min_age_months, max_age_months, age_label,
   duration_minutes, original_price, promo_price, description, is_active, sort_order,
   created_at, updated_at)
SELECT
  gen_random_uuid(), 'default-tenant', 'add-on-nebulizer-obat',
  'Kala Terapi – Nebulizer + Obat', 'ADD_ON', 0, NULL, 'Bayi & Anak',
  20, 60000, 50000,
  '[ADDON] Terapi uap inhalasi/penguapan dengan obat bronkodilator/pengencer dahak sesuai resep/indikasi dokter.',
  true,
  COALESCE((SELECT MAX(sort_order) + 1 FROM clinic_services WHERE tenant_id = 'default-tenant'), 0),
  NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM clinic_services
  WHERE tenant_id = 'default-tenant' AND service_id = 'add-on-nebulizer-obat'
);
