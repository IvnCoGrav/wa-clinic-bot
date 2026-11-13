import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isApiScopeAllowed, clearScopeCache } from '../../src/services/role-scope.service';
import { prisma } from '../../src/db/client';

describe('RBAC Scope Fail-Closed & Allow-List (Task 0.2)', () => {
  const tenantId = 'tenant-test-rbac';

  beforeEach(() => {
    clearScopeCache();
    vi.restoreAllMocks();
  });

  it('should FAIL-CLOSED (allowed: false) for a role that has NO rows in role_api_scopes', async () => {
    // Mock prisma.roleApiScope.findMany mengembalikan 0 baris
    (prisma as any).roleApiScope = {
      findMany: vi.fn().mockResolvedValue([]),
    };

    const decision = await isApiScopeAllowed(tenantId, 'unscoped_role', '/api/admin/services', 'GET');

    // Pada kode lama, role tanpa baris dianggap unmanaged/legacy dan lolos (allowed: true).
    // Pada model fail-closed, role tanpa baris WAJIB ditolak (allowed: false).
    expect(decision.allowed).toBe(false);
  });

  it('should allow access only when a matching scope row exists', async () => {
    (prisma as any).roleApiScope = {
      findMany: vi.fn().mockResolvedValue([
        { api_prefix: '/api/admin/services', methods: 'GET' },
      ]),
    };

    const allowedDecision = await isApiScopeAllowed(tenantId, 'scoped_role', '/api/admin/services', 'GET');
    expect(allowedDecision.allowed).toBe(true);

    const deniedMethodDecision = await isApiScopeAllowed(tenantId, 'scoped_role', '/api/admin/services', 'POST');
    expect(deniedMethodDecision.allowed).toBe(false);
  });

  it('should allow operational endpoints (services, staff, delivery-tiers) for admin_cs', async () => {
    (prisma as any).roleApiScope = {
      findMany: vi.fn().mockResolvedValue([
        { api_prefix: '/api/admin/services', methods: 'GET' },
        { api_prefix: '/api/admin/staff', methods: 'GET' },
        { api_prefix: '/api/admin/delivery-tiers', methods: 'GET' },
      ]),
    };

    const s1 = await isApiScopeAllowed(tenantId, 'admin_cs', '/api/admin/services', 'GET');
    const s2 = await isApiScopeAllowed(tenantId, 'admin_cs', '/api/admin/staff', 'GET');
    const s3 = await isApiScopeAllowed(tenantId, 'admin_cs', '/api/admin/delivery-tiers', 'GET');

    expect(s1.allowed).toBe(true);
    expect(s2.allowed).toBe(true);
    expect(s3.allowed).toBe(true);
  });
});
