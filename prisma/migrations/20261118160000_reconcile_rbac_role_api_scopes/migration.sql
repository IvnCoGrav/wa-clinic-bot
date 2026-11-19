-- KNOWN #358 (Fase 3, 2026-11-18):
-- Rekonsiliasi menyeluruh tabel `role_api_scopes`:
--   1. Hapus 16 baris orphan (7 prefix fiktif tanpa 1 pun rute backend cocok).
--   2. Hapus 2 baris kontradiktif `/api/admin/settings/notifications` untuk admin_cs/spv_cs
--      (diblokir keras di Layer 1 karena memuat rahasia telegramPairingToken — CD-02).
--   3. Terapkan keputusan bisnis K-1..K-5:
--      - K-1: `GET /api/admin/financial-analytics` hanya untuk `spv_cs` (tidak untuk `admin_cs`).
--      - K-3 (Opsi C): `GET /api/admin/customer-service` untuk `admin_cs`, `spv_cs`, `advertiser`
--        (POST tetap diblokir Layer 1 `superAdminWritePrefixes`).
--      - K-4: `POST /api/admin/copilot` untuk `admin_cs` & `spv_cs`.
--      - H-02b: `GET /api/admin/settings/payment-info` & `/pricelist-image` untuk `admin_cs` & `spv_cs`.
--      - K-5: Lengkapi scope aman/read-only untuk `advertiser` (tanpa approve-purchase & tanpa /debug).
--
-- Tenant-aware (semua tenant + default-tenant) & idempoten.

-- 1. Bersihkan 7 prefix fiktif (orphan) lintas seluruh role
DELETE FROM "role_api_scopes"
WHERE "api_prefix" IN (
  '/api/admin/analytics',
  '/api/admin/daily-report',
  '/api/admin/reports',
  '/api/admin/today-treatments',
  '/api/admin/broadcast',
  '/api/admin/staff/me',
  '/api/admin/staff/profile'
);

-- 2. Hapus baris kontradiktif yang diblokir Layer 1 (CD-02: lindungi telegramPairingToken)
DELETE FROM "role_api_scopes"
WHERE "api_prefix" = '/api/admin/settings/notifications'
  AND "role_key" IN ('admin_cs', 'spv_cs');

-- 3. Seed/update scope terverifikasi untuk admin_cs, spv_cs, dan advertiser
INSERT INTO "role_api_scopes" (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
SELECT gen_random_uuid(), t.id, p.role_key, p.api_prefix, p.methods, NOW(), NOW()
FROM (
  SELECT id FROM "tenants"
  UNION
  SELECT 'default-tenant'
) AS t
CROSS JOIN (
  VALUES
    -- admin_cs (H-02b, K-3 Opsi C, K-4)
    ('admin_cs', '/api/admin/settings/payment-info', 'GET'),
    ('admin_cs', '/api/admin/settings/pricelist-image', 'GET'),
    ('admin_cs', '/api/admin/copilot', 'POST'),
    ('admin_cs', '/api/admin/customer-service', 'GET'),

    -- spv_cs (H-02b, K-1, K-3 Opsi C, K-4)
    ('spv_cs', '/api/admin/settings/payment-info', 'GET'),
    ('spv_cs', '/api/admin/settings/pricelist-image', 'GET'),
    ('spv_cs', '/api/admin/copilot', 'POST'),
    ('spv_cs', '/api/admin/customer-service', 'GET'),
    ('spv_cs', '/api/admin/financial-analytics', 'GET'),

    -- advertiser (K-3 Opsi C, K-5 read-only + operasi iklan aman)
    ('advertiser', '/api/admin/customer-service', 'GET'),
    ('advertiser', '/api/admin/landings', 'GET'),
    ('advertiser', '/api/admin/capi-queue', 'GET'),
    ('advertiser', '/api/admin/health', 'GET'),
    ('advertiser', '/api/admin/roles', 'GET'),
    ('advertiser', '/api/admin/push/public-key', 'GET'),
    ('advertiser', '/api/admin/push/subscribe', 'POST'),
    ('advertiser', '/api/admin/push/unsubscribe', 'POST')
) AS p(role_key, api_prefix, methods)
ON CONFLICT (tenant_id, role_key, api_prefix)
DO UPDATE SET methods = EXCLUDED.methods, updated_at = NOW();
