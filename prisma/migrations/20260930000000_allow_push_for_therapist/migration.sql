-- Remediasi kebocoran notifikasi: izinkan peran therapist melakukan self-registration
-- Web Push (VAPID) TANPA membuka endpoint push sensitif.
--
-- Konteks: sejak SEC-AUDIT-04, therapist = role "managed" (punya baris di
-- role_api_scopes) → default-deny. Akibatnya rebind token push ke staffId gagal 403
-- di GET /api/admin/push/public-key, sehingga token perangkat tetap tercatat sebagai
-- ADMIN (ghost subscription) dan notifikasi chat umum bocor ke perangkat terapis.
--
-- Keputusan fondasional (data-driven, bukan bypass hardcode di kode): seed prefix
-- GRANULAR hanya untuk endpoint pendaftaran/pemutusan mandiri. Endpoint sensitif
-- `/api/admin/push/test`, `/test-staff`, dan `/staff-device-counts` TIDAK di-seed →
-- tetap default-deny untuk therapist.
--
-- Tenant-aware: seed untuk SETIAP tenant yang ada, dengan fallback 'default-tenant'
-- bila tabel tenants kosong (fresh env). Idempoten via ON CONFLICT DO NOTHING.

INSERT INTO "role_api_scopes" (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'therapist', p.api_prefix, p.methods, NOW(), NOW()
FROM (
  SELECT id FROM "tenants"
  UNION
  SELECT 'default-tenant'
) AS t
CROSS JOIN (
  VALUES
    ('/api/admin/push/public-key', 'GET'),
    ('/api/admin/push/subscribe', 'POST'),
    ('/api/admin/push/unsubscribe', 'POST')
) AS p(api_prefix, methods)
ON CONFLICT (tenant_id, role_key, api_prefix) DO NOTHING;
