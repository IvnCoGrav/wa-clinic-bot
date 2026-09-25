-- Tambah terapi Pulih Ceria Newborn 0-6 bulan (menutup lubang cakupan rebrand Kala).
-- Pra-rebrand baby-massage-pulih-ceria mencakup 0.5-24 bln ("Minimal 2 Minggu"); pasca-rebrand
-- menyempit ke 7-24 bln sehingga bayi 0-6 bln bapil/kembung tanpa terapi STANDARD (CM-06/CM-22).
-- Idempoten (ON CONFLICT DO NOTHING) + per-tenant default-tenant. Tenant lain: duplikasi via dashboard/admin API.
-- Harga/tier WAJIB konfirmasi Bidan (dicatat di docs/KNOWN_ISSUES.md #128) — ubah via dashboard, bukan migrasi baru.
-- Rollback jujur: UPDATE clinic_services SET is_active=false WHERE service_id='baby-massage-pulih-ceria-newborn'.
INSERT INTO clinic_services
  (id, tenant_id, service_id, name, category, min_age_months, max_age_months, age_label,
   duration_minutes, original_price, promo_price, description, is_active, sort_order,
   created_at, updated_at)
SELECT
  gen_random_uuid(), 'default-tenant', 'baby-massage-pulih-ceria-newborn',
  'Kala Baby – Pijat Pulih Ceria Newborn', 'BABY', 0, 6, '0 - 6 Bulan',
  40, 100000, 75000,
  'Terapi khusus batuk, pilek (bapil), flu, rewel, susah BAB, kembung/kolik pada bayi newborn 0-6 bulan dengan double aromaterapi & titik akupresur lembut.',
  true,
  COALESCE((SELECT MAX(sort_order) + 1 FROM clinic_services WHERE tenant_id = 'default-tenant'), 0),
  NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM clinic_services
  WHERE tenant_id = 'default-tenant' AND service_id = 'baby-massage-pulih-ceria-newborn'
);
