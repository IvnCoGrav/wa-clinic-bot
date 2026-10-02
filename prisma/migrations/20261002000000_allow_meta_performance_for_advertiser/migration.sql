-- Izin BACA (GET) laporan performa iklan Meta to Sales untuk peran advertiser.
--
-- Konteks: endpoint laporan baru `GET /api/admin/meta-performance` sengaja
-- diletakkan DI LUAR prefix `/api/admin/debug` (yang Super-Admin only,
-- admin.route.ts:198-215). Sejak SEC-AUDIT-04, role yang punya baris di
-- role_api_scopes = "managed" → default-deny. Agar advertiser bisa membaca
-- dashboard performa (bukan endpoint CAPI/debug sensitif), seed prefix ini.
--
-- Read-only: hanya method GET. POST/PUT ke prefix ini TIDAK di-seed → default-deny.
-- Tenant-aware: seed untuk SETIAP tenant yang ada, fallback 'default-tenant'
-- bila tabel tenants kosong (fresh env). Idempoten via ON CONFLICT DO NOTHING.

INSERT INTO "role_api_scopes" (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'advertiser', p.api_prefix, p.methods, NOW(), NOW()
FROM (
  SELECT id FROM "tenants"
  UNION
  SELECT 'default-tenant'
) AS t
CROSS JOIN (
  VALUES
    ('/api/admin/meta-performance', 'GET')
) AS p(api_prefix, methods)
ON CONFLICT (tenant_id, role_key, api_prefix) DO NOTHING;
