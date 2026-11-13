-- Fase 2.1.4: Tambahkan cakupan izin operasional untuk peran admin_cs dan spv_cs
-- Membuka akses baca katalog treatment (services), delivery tiers, staff, dll.
-- agar staf CS dan supervisor dapat membuat reservasi dan melayani pasien.
--
-- Idempoten: menggunakan ON CONFLICT DO UPDATE.
-- Tenant-aware: mencakup semua penyewa aktif + default-tenant.

-- 1. Scopes untuk role: admin_cs
INSERT INTO "role_api_scopes" (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'admin_cs', p.api_prefix, p.methods, NOW(), NOW()
FROM (
  SELECT id FROM "tenants"
  UNION
  SELECT 'default-tenant'
) AS t
CROSS JOIN (
  VALUES
    ('/api/admin/services', 'GET'),
    ('/api/admin/delivery-tiers', 'GET'),
    ('/api/admin/staff', 'GET'),
    ('/api/admin/reservation-series', '*'),
    ('/api/admin/labels', '*'),
    ('/api/admin/quick-replies', '*'),
    ('/api/admin/geo/areas', 'GET'),
    ('/api/admin/gateway-capability', 'GET'),
    ('/api/admin/health', 'GET'),
    ('/api/admin/capi-queue', 'GET'),
    ('/api/admin/knowledge', 'GET')
) AS p(api_prefix, methods)
ON CONFLICT (tenant_id, role_key, api_prefix) 
DO UPDATE SET methods = EXCLUDED.methods, updated_at = NOW();

-- 2. Scopes untuk role: spv_cs
INSERT INTO "role_api_scopes" (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'spv_cs', p.api_prefix, p.methods, NOW(), NOW()
FROM (
  SELECT id FROM "tenants"
  UNION
  SELECT 'default-tenant'
) AS t
CROSS JOIN (
  VALUES
    ('/api/admin/services', 'GET'),
    ('/api/admin/delivery-tiers', 'GET'),
    ('/api/admin/reservation-series', '*'),
    ('/api/admin/labels', '*'),
    ('/api/admin/quick-replies', '*'),
    ('/api/admin/geo/areas', 'GET'),
    ('/api/admin/gateway-capability', 'GET'),
    ('/api/admin/health', 'GET'),
    ('/api/admin/capi-queue', 'GET'),
    ('/api/admin/knowledge', 'GET')
) AS p(api_prefix, methods)
ON CONFLICT (tenant_id, role_key, api_prefix) 
DO UPDATE SET methods = EXCLUDED.methods, updated_at = NOW();
