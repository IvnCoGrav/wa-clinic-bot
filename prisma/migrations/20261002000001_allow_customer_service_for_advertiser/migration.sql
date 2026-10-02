-- Izin akses modul CTA & Greetings WA (`/api/admin/customer-service`) untuk peran advertiser.
--
-- Konteks: role advertiser sejak SEC-AUDIT-04 punya baris di `role_api_scopes`
-- (migrasi 20261002000000_allow_meta_performance_for_advertiser) sehingga menjadi
-- "managed" → default-deny. Menu sidebar "CTA & Greetings WA" kini ditampilkan untuk
-- advertiser (restorasi navigasi 2026-10-02), namun GET/POST `/api/admin/customer-service`
-- akan 403 tanpa seed ini.
--
-- Cakupan: GET + POST (halaman membaca konfigurasi & menyimpan teks Greetings/Promo [%ID%]).
-- Tenant-aware: seed untuk SETIAP tenant yang ada, fallback 'default-tenant' bila tabel
-- tenants kosong (fresh env). Idempoten via ON CONFLICT DO NOTHING.

INSERT INTO "role_api_scopes" (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'advertiser', p.api_prefix, p.methods, NOW(), NOW()
FROM (
  SELECT id FROM "tenants"
  UNION
  SELECT 'default-tenant'
) AS t
CROSS JOIN (
  VALUES
    ('/api/admin/customer-service', 'GET,POST')
) AS p(api_prefix, methods)
ON CONFLICT (tenant_id, role_key, api_prefix) DO NOTHING;
