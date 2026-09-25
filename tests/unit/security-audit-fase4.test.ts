import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { clearScopeCache } from '../../src/services/role-scope.service';

/**
 * SEC-AUDIT Fase 4 adversarial:
 * - 4-1 tenant diambil dari sesi staff (bukan default-tenant).
 * - 4-2 CSRF: cookie-auth state-changing wajib header X-Requested-With.
 */
describe('Security Audit Fase 4 (isolasi tenant & CSRF)', () => {
  const app = buildApp();
  const superAdminKey = 'test_sec_audit_fase4_key';

  const mockStaff = (tenantId: string) =>
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      staff: {
        id: 'staff-X',
        tenant_id: tenantId,
        name: 'CS Tenant B',
        phone: '628222',
        role: 'ADMIN_CS',
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
        telegram_chat_id: null,
      },
      session: { id: 's', staff_id: 'staff-X', token: 't', expires_at: new Date(Date.now() + 86400000), created_at: new Date() },
    } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = superAdminKey;
    clearScopeCache();
  });

  describe('4-2 CSRF guard', () => {
    it('cookie-auth POST tanpa X-Requested-With → 403 FORBIDDEN_CSRF', async () => {
      mockStaff('default-tenant');
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/roles',
        headers: { cookie: 'staff_session=tok' },
        payload: { key: 'x', label: 'X' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_CSRF');
    });

    it('cookie-auth POST dengan X-Requested-With → lolos CSRF (diproses RBAC berikutnya)', async () => {
      mockStaff('default-tenant');
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/roles',
        headers: { cookie: 'staff_session=tok', 'x-requested-with': 'XMLHttpRequest' },
        payload: { key: 'x', label: 'X' },
      });
      // Bukan FORBIDDEN_CSRF — guard RBAC/scope yang berlaku setelahnya.
      expect(res.json().code).not.toBe('FORBIDDEN_CSRF');
    });

    it('API-key POST tidak terkena CSRF (imun, header eksplisit)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/roles',
        headers: { 'x-api-key': superAdminKey },
        payload: { key: 'testrole', label: 'Test Role' },
      });
      expect(res.statusCode).not.toBe(403);
    });

    it('GET cookie-auth tidak butuh header CSRF', async () => {
      mockStaff('default-tenant');
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/auth/me',
        headers: { cookie: 'staff_session=tok' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('4-1 tenant dari sesi staff', () => {
    it('staf Tenant B → query reservasi memakai tenant B, bukan default-tenant', async () => {
      mockStaff('tenant-B');
      // Scope harus mengizinkan GET reservations agar guard 2-2 tidak menutup lebih dulu.
      const { prisma } = await import('../../src/db/client');
      clearScopeCache();
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue([{ api_prefix: '/api/admin/reservations', methods: 'GET' }]),
      };

      let capturedWhere: any = null;
      (prisma.reservation as any).findMany = vi.fn().mockImplementation((args: any) => {
        capturedWhere = args?.where;
        return Promise.resolve([]);
      });
      (prisma.reservation as any).count = vi.fn().mockResolvedValue(0);

      await app.inject({
        method: 'GET',
        url: '/api/admin/reservations?limit=1',
        headers: { cookie: 'staff_session=tok' },
      });

      expect(capturedWhere?.tenant_id).toBe('tenant-B');
    });
  });
});
