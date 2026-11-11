import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';

/**
 * Cfg-014: role sistem (therapist/admin_cs/spv_cs) TIDAK boleh ditimpa lewat
 * API — `allowedPaths` role sistem bisa dieksploitasi menjadi akses penuh.
 * Fallback memori juga diisolasi per tenant (bukan Map global).
 */
describe('Admin roles — hardening role sistem (Cfg-014)', () => {
  const app = buildApp();
  const headers = { 'x-api-key': 'test_admin_key_roles_hardening' };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_roles_hardening';
  });

  it('POST upsert role sistem → 409 SYSTEM_ROLE_IMMUTABLE (allowedPaths tidak bisa ditimpa)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/roles',
      headers,
      payload: {
        key: 'admin_cs',
        label: 'Admin CS Disusupi',
        allowedPaths: ['*'],
        defaultRedirect: '/tenant/overview',
      },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('SYSTEM_ROLE_IMMUTABLE');
  });

  it('POST role sistem dengan variasi kapitalisasi/spasi tetap ditolak', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/roles',
      headers,
      payload: { key: '  Admin_CS ', label: 'X', allowedPaths: ['/tenant/overview'] },
    });
    expect(res.statusCode).toBe(409);
  });
});
