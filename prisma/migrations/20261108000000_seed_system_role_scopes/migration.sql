-- S-002 / Fase 2.1.3: Seed cakupan izin API minimal untuk peran sistem
-- (admin_cs, spv_cs, therapist) agar sistem fail-closed tidak mengunci peran sah.
--
-- Idempoten: menggunakan ON CONFLICT DO NOTHING.
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
    ('/api/admin/reservations', '*'),
    ('/api/admin/reservation', '*'),
    ('/api/admin/today-treatments', 'GET,PATCH'),
    ('/api/admin/live-chat', '*'),
    ('/api/admin/customers', 'GET,POST,PUT,PATCH'),
    ('/api/admin/customer-service', 'GET,POST'),
    ('/api/admin/settings', 'GET'),
    ('/api/admin/settings/notifications', 'GET'),
    ('/api/admin/settings/notifications/logs', 'GET'),
    ('/api/admin/settings/daily-report', 'GET'),
    ('/api/admin/reports', 'GET'),
    ('/api/admin/analytics', 'GET'),
    ('/api/admin/daily-report', 'GET'),
    ('/api/admin/push/public-key', 'GET'),
    ('/api/admin/push/subscribe', 'POST'),
    ('/api/admin/push/unsubscribe', 'POST'),
    ('/api/admin/staff/me', 'GET,PATCH'),
    ('/api/admin/staff/profile', 'GET,PATCH')
) AS p(api_prefix, methods)
ON CONFLICT (tenant_id, role_key, api_prefix) DO NOTHING;

-- 2. Scopes untuk role: spv_cs (mencakup hak admin_cs + laporan supervisi)
INSERT INTO "role_api_scopes" (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'spv_cs', p.api_prefix, p.methods, NOW(), NOW()
FROM (
  SELECT id FROM "tenants"
  UNION
  SELECT 'default-tenant'
) AS t
CROSS JOIN (
  VALUES
    ('/api/admin/reservations', '*'),
    ('/api/admin/reservation', '*'),
    ('/api/admin/today-treatments', 'GET,PATCH'),
    ('/api/admin/live-chat', '*'),
    ('/api/admin/customers', 'GET,POST,PUT,PATCH'),
    ('/api/admin/customer-service', 'GET,POST'),
    ('/api/admin/settings', 'GET'),
    ('/api/admin/settings/notifications', 'GET'),
    ('/api/admin/settings/notifications/logs', 'GET'),
    ('/api/admin/settings/daily-report', 'GET'),
    ('/api/admin/reports', 'GET'),
    ('/api/admin/analytics', 'GET'),
    ('/api/admin/daily-report', 'GET'),
    ('/api/admin/push/public-key', 'GET'),
    ('/api/admin/push/subscribe', 'POST'),
    ('/api/admin/push/unsubscribe', 'POST'),
    ('/api/admin/staff/me', 'GET,PATCH'),
    ('/api/admin/staff/profile', 'GET,PATCH'),
    ('/api/admin/staff', 'GET'),
    ('/api/admin/staff-retention', 'GET'),
    ('/api/admin/meta-performance', 'GET'),
    ('/api/admin/broadcast', 'GET,POST')
) AS p(api_prefix, methods)
ON CONFLICT (tenant_id, role_key, api_prefix) DO NOTHING;

-- 3. Scopes untuk role: therapist (today-treatments read-only)
INSERT INTO "role_api_scopes" (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'therapist', p.api_prefix, p.methods, NOW(), NOW()
FROM (
  SELECT id FROM "tenants"
  UNION
  SELECT 'default-tenant'
) AS t
CROSS JOIN (
  VALUES
    ('/api/admin/today-treatments', 'GET')
) AS p(api_prefix, methods)
ON CONFLICT (tenant_id, role_key, api_prefix) DO NOTHING;
