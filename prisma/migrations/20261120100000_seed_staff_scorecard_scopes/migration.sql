-- Seed scope Staff Scorecard untuk ADMIN_CS.
--
-- Konteks: RBAC scope bersifat data-driven (tabel role_api_scopes) dan default-deny.
-- Tanpa baris ini, ADMIN_CS mendapat 403 pada:
--   GET  /api/admin/staff-scorecard/policy
--   GET  /api/admin/staff-scorecard/evidence
--   POST /api/admin/staff-scorecard/evidence/:id/review
--
-- PUT policy TIDAK di-seed: hanya Super Admin (API key owner / role SUPER_ADMIN)
-- yang boleh mengubah bobot dan ambang. Route juga menegakkan aturan ini.
--
-- Tenant-aware dan idempoten.

INSERT INTO "role_api_scopes" (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'admin_cs', '/api/admin/staff-scorecard', 'GET,POST', NOW(), NOW()
FROM (
  SELECT id FROM "tenants"
  UNION
  SELECT 'default-tenant'
) AS t
ON CONFLICT (tenant_id, role_key, api_prefix) DO NOTHING;
