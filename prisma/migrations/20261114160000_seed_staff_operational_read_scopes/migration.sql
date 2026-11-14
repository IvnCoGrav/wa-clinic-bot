-- KNOWN #324 & #325 (2026-11-14): cakupan BACA operasional untuk staf non-Super-Admin.
--
-- Konteks (bukti log produksi):
--   - `[RBAC SCOPE GUARD] Blocked 'ADMIN_CS' on GET /api/admin/roles`
--     → `AuthContext.tsx` memanggil endpoint ini setiap login/refresh dashboard.
--   - `[RBAC GUARD] Blocked unauthorized access attempt by staff role 'ADMIN_CS'
--      on GET /api/admin/tenant-settings`
--     → form reservasi butuh titik klinik (`clinicLocation`).
--
-- Kontrak keamanan:
--   - Hanya GET yang di-seed. TULIS `/api/admin/tenant-settings` tetap diblokir
--     guard `superAdminWritePrefixes` (PATCH/POST/PUT = Super Admin only).
--   - Respons GET tenant-settings tidak memuat rahasia: `staffNotification`
--     hanya berisi `telegramEnabled` (token Telegram tidak pernah dikirim).
--   - THERAPIST hanya mendapat daftar role (tidak butuh setelan tenant).
--
-- Tenant-aware: seed untuk SETIAP tenant yang ada + `default-tenant` (fresh env),
-- idempoten via ON CONFLICT DO NOTHING (tidak menimpa scope yang lebih luas).

INSERT INTO "role_api_scopes" (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
SELECT gen_random_uuid(), t.id, p.role_key, p.api_prefix, p.methods, NOW(), NOW()
FROM (
  SELECT id FROM "tenants"
  UNION
  SELECT 'default-tenant'
) AS t
CROSS JOIN (
  VALUES
    ('admin_cs', '/api/admin/roles', 'GET'),
    ('admin_cs', '/api/admin/tenant-settings', 'GET'),
    ('spv_cs', '/api/admin/roles', 'GET'),
    ('spv_cs', '/api/admin/tenant-settings', 'GET'),
    ('therapist', '/api/admin/roles', 'GET')
) AS p(role_key, api_prefix, methods)
ON CONFLICT (tenant_id, role_key, api_prefix) DO NOTHING;
