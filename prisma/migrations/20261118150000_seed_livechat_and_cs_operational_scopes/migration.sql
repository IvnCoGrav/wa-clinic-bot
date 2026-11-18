-- KNOWN #358 (Fase 1, 2026-11-18):
-- Buka scope operasional CS (admin_cs & spv_cs) yang terblokir 403 pasca-aktivasi
-- fail-closed RBAC (20261108000000_seed_system_role_scopes):
--   1. /api/admin/conversations & /api/admin/conversation (*): jaring pengaman
--      backward-compat bagi browser/PWA cache lama yang masih memanggil rute
--      legacy Edit, Tarik, Read/Unread, Pin, Takeover, Release (CD-05).
--   2. /api/admin/dispatch/trip (GET): widget pelacakan perjalanan terapis di Live Chat.
--   3. /api/admin/follow-ups (*) & /api/admin/follow-up-templates (*): antrean
--      dan template follow-up yang sudah terbuka di allowed_paths CS.
--   4. /api/admin/customers/:id/addresses (DELETE): hapus kartu alamat di
--      AddressBookDrawer tanpa membuka DELETE /api/admin/customers/:id (CD-03).
--
-- Tenant-aware (semua tenant + default-tenant) & idempoten (ON CONFLICT DO UPDATE).

INSERT INTO "role_api_scopes" (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
SELECT gen_random_uuid(), t.id, r.role_key, p.api_prefix, p.methods, NOW(), NOW()
FROM (
  SELECT id FROM "tenants"
  UNION
  SELECT 'default-tenant'
) AS t
CROSS JOIN (
  VALUES ('admin_cs'), ('spv_cs')
) AS r(role_key)
CROSS JOIN (
  VALUES
    ('/api/admin/conversations', '*'),
    ('/api/admin/conversation', '*'),
    ('/api/admin/dispatch/trip', 'GET'),
    ('/api/admin/follow-ups', '*'),
    ('/api/admin/follow-up-templates', '*'),
    ('/api/admin/customers/:id/addresses', 'DELETE')
) AS p(api_prefix, methods)
ON CONFLICT (tenant_id, role_key, api_prefix)
DO UPDATE SET methods = EXCLUDED.methods, updated_at = NOW();
