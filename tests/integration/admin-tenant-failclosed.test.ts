import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';

/**
 * Fase 1.1 (Ar-003/Cfg-012): mode multi-tenant harus fail-closed di level route.
 * Single-tenant (default) tetap menerima request tanpa header tenant.
 */
describe('Admin route — tenant fail-closed multi-tenant', () => {
  const app = buildApp();
  const original = process.env.MULTI_TENANT_ENABLED;
  const headers = { 'x-api-key': 'test_admin_key_mt_gate' };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_mt_gate';
    delete process.env.MULTI_TENANT_ENABLED;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.MULTI_TENANT_ENABLED;
    else process.env.MULTI_TENANT_ENABLED = original;
  });

  it('single-tenant: tanpa header tenant tetap 200 (backward-compatible)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/roles', headers });
    expect(res.statusCode).toBe(200);
  });

  it('multi-tenant: tanpa header tenant → 401 TENANT_REQUIRED (bukan menulis default-tenant)', async () => {
    process.env.MULTI_TENANT_ENABLED = 'true';
    const res = await app.inject({ method: 'GET', url: '/api/admin/roles', headers });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe('TENANT_REQUIRED');
  });

  it('multi-tenant: dengan header tenant → diteruskan (200)', async () => {
    process.env.MULTI_TENANT_ENABLED = 'true';
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/roles',
      headers: { ...headers, 'x-tenant-id': 'tenant-b' },
    });
    expect(res.statusCode).toBe(200);
  });
});
