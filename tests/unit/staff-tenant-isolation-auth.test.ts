import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { AdminSessionService } from '../../src/services/admin-session.service';
import { prisma } from '../../src/db/client';
import * as bcryptUtil from '../../src/utils/bcrypt';

describe('API-02 & API-03: Staff Tenant Isolation & Impersonation', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'super_secret_admin_key';
  });

  describe('API-03: Unified Login Staff per-tenant', () => {
    it('login staf pada tenant non-default mencari staf dengan tenant_id yang diminta', async () => {
      const findFirstSpy = vi.spyOn(prisma.staff, 'findFirst').mockResolvedValue({
        id: 'staff-b-1',
        tenant_id: 'tenant-b',
        name: 'Bidan Cabang B',
        phone: '081299991111',
        password_hash: 'hashed_pw',
        role: 'THERAPIST',
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
      } as any);

      vi.spyOn(bcryptUtil, 'verifyPassword').mockResolvedValue(true);
      const loginSpy = vi.spyOn(StaffAuthService, 'login').mockResolvedValue({
        token: 'token_tenant_b',
        staff: {
          id: 'staff-b-1',
          name: 'Bidan Cabang B',
          phone: '081299991111',
          role: 'THERAPIST',
        } as any,
        expiresAt: new Date(Date.now() + 43200000),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/auth/login',
        headers: {
          'x-tenant-id': 'tenant-b',
        },
        payload: {
          identifier: '081299991111',
          password: 'password_b',
          tenantId: 'tenant-b',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(findFirstSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: 'tenant-b',
          }),
        })
      );
      expect(loginSpy).toHaveBeenCalledWith('081299991111', 'password_b', 'tenant-b');
    });
  });

  describe('API-02: Admin Impersonation di Staff Route', () => {
    it('admin impersonation mengadopsi tenant_id dari header x-tenant-id (bukan hardcoded default-tenant)', async () => {
      vi.spyOn(AdminSessionService, 'validateSession').mockResolvedValue({
        id: 'admin-sess-1',
        token: 'admin_cookie_token',
        adminIdentity: 'Admin Cabang B',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/staff/auth/me',
        headers: {
          cookie: 'admin_session=admin_cookie_token',
          'x-tenant-id': 'tenant-b',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.staff.tenant_id).toBe('tenant-b');
    });
  });
});
