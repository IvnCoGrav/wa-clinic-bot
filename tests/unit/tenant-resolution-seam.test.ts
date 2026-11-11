import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveSessionTenantId, isMultiTenantEnabled } from '../../src/routes/admin/route-helpers';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Ar-003/Cfg-012 (fase 1.1): seam resolusi tenant sesi admin.
 * Mode single-tenant (default) mempertahankan perilaku lama; mode multi-tenant
 * WAJIB eksplisit (fail-closed) agar tidak ada penulisan ke `default-tenant`.
 */
describe('Seam resolusi tenant admin (Ar-003/Cfg-012)', () => {
  const original = process.env.MULTI_TENANT_ENABLED;

  beforeEach(() => {
    delete process.env.MULTI_TENANT_ENABLED;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.MULTI_TENANT_ENABLED;
    else process.env.MULTI_TENANT_ENABLED = original;
  });

  const req = (headers: Record<string, any> = {}, extra: Record<string, any> = {}) =>
    ({ headers, ...extra }) as any;

  it('default (single-tenant): tanpa tenant eksplisit → default-tenant', () => {
    expect(isMultiTenantEnabled()).toBe(false);
    expect(resolveSessionTenantId(req())).toBe(DEFAULT_TENANT_ID);
  });

  it('tenant yang sudah di-set sesi staf MENANG atas header (anti spoof)', () => {
    const r = req({ 'x-tenant-id': 'tenant-palsu' }, { tenantId: 'tenant-staf' });
    expect(resolveSessionTenantId(r)).toBe('tenant-staf');
  });

  it('header x-tenant-id dipakai bila sesi belum menetapkan tenant', () => {
    expect(resolveSessionTenantId(req({ 'x-tenant-id': ' tenant-b ' }))).toBe('tenant-b');
  });

  it('query tenant_id dipakai sebagai fallback terakhir', () => {
    expect(resolveSessionTenantId(req({}, { query: { tenant_id: 'tenant-c' } }))).toBe('tenant-c');
  });

  it('multi-tenant ON tanpa tenant eksplisit → 401 TENANT_REQUIRED (fail-closed)', () => {
    process.env.MULTI_TENANT_ENABLED = 'true';
    expect(isMultiTenantEnabled()).toBe(true);
    let err: any;
    try {
      resolveSessionTenantId(req());
    } catch (e) {
      err = e;
    }
    expect(err?.statusCode).toBe(401);
    expect(err?.code).toBe('TENANT_REQUIRED');
  });

  it('multi-tenant ON dengan tenant eksplisit tetap lolos', () => {
    process.env.MULTI_TENANT_ENABLED = 'TRUE';
    expect(resolveSessionTenantId(req({ 'x-tenant-id': 'tenant-b' }))).toBe('tenant-b');
  });
});
