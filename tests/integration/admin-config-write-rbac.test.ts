import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/services/role-scope.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/role-scope.service')>();
  return { ...actual, isApiScopeAllowed: vi.fn().mockResolvedValue({ allowed: true, managed: false }) };
});

import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';

/** Cfg-013 Opsi A: tulis katalog/tier/meta hanya Super Admin; baca tetap boleh. */
describe('RBAC tulis konfigurasi — Super Admin only (Cfg-013)', () => {
  const app = buildApp();
  const staffHeaders = { cookie: 'staff_session=cs', 'x-requested-with': 'XMLHttpRequest' };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_cfg013';
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      staff: { id: 'cs1', name: 'CS', role: 'ADMIN_CS', active: true, tenant_id: 'default-tenant' },
      expires_at: new Date(Date.now() + 3600_000),
      revoked_at: null,
    } as any);
  });

  it.each([
    ['POST', '/api/admin/services'],
    ['PUT', '/api/admin/services/svc-1'],
    ['DELETE', '/api/admin/services/svc-1'],
    ['POST', '/api/admin/delivery-tiers'],
    ['PUT', '/api/admin/meta-performance/settings'],
  ])('%s %s oleh ADMIN_CS → 403', async (method, url) => {
    const res = await app.inject({ method: method as any, url, headers: staffHeaders, payload: {} });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('FORBIDDEN_SUPER_ADMIN_ONLY_WRITE');
  });

  it('GET katalog oleh ADMIN_CS tetap boleh (bukan 403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/services', headers: staffHeaders });
    expect(res.statusCode).not.toBe(403);
  });
});
