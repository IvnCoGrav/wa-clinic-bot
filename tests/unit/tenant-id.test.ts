import { describe, it, expect } from 'vitest';
import { isValidTenantId, assertValidTenantId, TENANT_ID_PATTERN } from '../../src/utils/tenant-id';

describe('tenant-id seam', () => {
  it('menerima id tenant kanonik', () => {
    for (const ok of ['default-tenant', 't1', 'Tenant_A.B-C', 'a'.repeat(64)]) {
      expect(isValidTenantId(ok)).toBe(true);
      expect(assertValidTenantId(ok)).toBe(ok);
    }
  });

  it('menolak traversal dan karakter path', () => {
    const bad = ['../x', '..\\x', 'a/b', '..', '.', '', ' ', 'a b', 'tenant/../x', 'tenant%2f..', '-abc', '.abc'];
    for (const v of bad) {
      expect(isValidTenantId(v)).toBe(false);
      expect(() => assertValidTenantId(v)).toThrow(/tenantId tidak valid/);
    }
  });

  it('menolak nilai non-string dan panjang berlebih', () => {
    for (const v of [null, undefined, 12, {}, [], 'a'.repeat(65)]) {
      expect(isValidTenantId(v)).toBe(false);
    }
  });

  it('error membawa statusCode/code untuk handler HTTP', () => {
    try {
      assertValidTenantId('../evil');
      throw new Error('harusnya throw');
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('INVALID_TENANT_ID');
    }
  });

  it('pola tidak menggunakan wildcard longgar', () => {
    expect(TENANT_ID_PATTERN.test('*')).toBe(false);
    expect(TENANT_ID_PATTERN.test('a*')).toBe(false);
  });
});
