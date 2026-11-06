-- Izin akses modul CTWA Greeting Catchers (`/api/admin/ctwa-catchers`) untuk peran advertiser.
--
-- Konteks: tab "Greeting Catchers CTWA" kini dikonsolidasikan ke dalam menu "CTA & Greetings WA"
-- yang diakses oleh role advertiser.
-- Cakupan: GET,POST,PUT,DELETE (kelola kampanye penangkap sapaan CTWA).
-- Tenant-aware: idempoten via ON CONFLICT DO NOTHING.

INSERT INTO "role_api_scopes" (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'advertiser', p.api_prefix, p.methods, NOW(), NOW()
FROM (
  SELECT id FROM "tenants"
  UNION
  SELECT 'default-tenant'
) AS t
CROSS JOIN (
  VALUES
    ('/api/admin/ctwa-catchers', 'GET,POST,PUT,DELETE')
) AS p(api_prefix, methods)
ON CONFLICT (tenant_id, role_key, api_prefix) DO NOTHING;
