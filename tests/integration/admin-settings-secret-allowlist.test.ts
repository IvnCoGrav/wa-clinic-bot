import { describe, it, expect, beforeEach, vi } from 'vitest';

// Scope data-driven (`role_api_scopes`) di-mock agar test fokus ke allowlist
// rahasia; isolasi fail-closed scope sudah diuji di rbac-scope-fail-closed.test.ts.
vi.mock('../../src/services/role-scope.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/role-scope.service')>();
  return {
    ...actual,
    isApiScopeAllowed: vi.fn().mockResolvedValue({ allowed: true, managed: false }),
  };
});

import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';

/**
 * Cfg-004: token pairing Telegram adalah rahasia tenant. Endpoint
 * `GET /api/admin/settings/notifications` memuat `telegramPairingToken`, jadi
 * TIDAK boleh ada di allowlist baca staf operasional (ADMIN_CS/SPV_CS).
 * Log notifikasi tetap boleh dibaca untuk monitoring.
 */
describe('Allowlist baca settings — rahasia tenant (Cfg-004)', () => {
  const app = buildApp();
  const tenantId = 'tenant-secret-test';

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_secret_allowlist';
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      token: 'staff_token',
      expires_at: new Date(Date.now() + 3600_000),
      revoked_at: null,
      staff: {
        id: 'staff-cs-1',
        name: 'CS Satu',
        role: 'ADMIN_CS',
        active: true,
        tenant_id: tenantId,
      },
    } as any);
  });

  const staffHeaders = { cookie: 'staff_session=staff_token' };

  it('ADMIN_CS dilarang membaca endpoint yang memuat token pairing (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/settings/notifications',
      headers: staffHeaders,
    });
    expect(res.statusCode).toBe(403);
  });

  it('ADMIN_CS tetap boleh membaca log notifikasi (monitoring, 200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/settings/notifications/logs',
      headers: staffHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });
});
