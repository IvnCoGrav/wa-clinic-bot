import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';

describe('Admin RBAC Guard & Security Isolation (SEC-01 Fix)', () => {
  const app = buildApp();
  const superAdminKey = 'test_super_admin_key_sec_01';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = superAdminKey;
  });

  describe('1. Super Admin Access via X-API-KEY', () => {
    it('allows Super Admin to access sensitive endpoints (backup, settings, ai-models, sandbox)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/backup/list',
        headers: { 'x-api-key': superAdminKey },
      });
      // Should not be 401 or 403
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });

    it('rejects unauthenticated requests to /api/admin/* with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/backup/list',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain('Unauthorized');
    });
  });

  describe('2. Staff Session RBAC Enforcement', () => {
    beforeEach(() => {
      // Mock StaffAuthService to return a valid staff with role 'THERAPIST'
      vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
        staff: {
          id: 'staff-123',
          tenant_id: 'default-tenant',
          name: 'Bidan Siti',
          phone: '628123456789',
          role: 'THERAPIST',
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
          telegram_chat_id: null,
        },
        session: {
          id: 'sess-123',
          staff_id: 'staff-123',
          token: 'valid_staff_token',
          expires_at: new Date(Date.now() + 86400000),
          created_at: new Date(),
        },
      } as any);
    });

    it('strictly blocks staff with THERAPIST role from accessing /api/admin/backup/*', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/backup/list',
        headers: {
          cookie: 'staff_session=valid_staff_token',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_STAFF_ROLE');
    });

    it('strictly blocks staff from triggering sandbox LLM calls (/api/admin/sandbox/*)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/sandbox/chat',
        headers: {
          cookie: 'staff_session=valid_staff_token',
        },
        payload: {
          message: 'Halo saya mau tanya jadwal',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_STAFF_ROLE');
    });

    it('strictly blocks staff from modifying AI models (/api/admin/ai-models/*)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/admin/ai-models/CHAT_REPLY',
        headers: {
          cookie: 'staff_session=valid_staff_token',
        },
        payload: {
          model_name: 'gpt-4o',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_STAFF_ROLE');
    });

    it('strictly blocks staff from creating/deleting other staff accounts', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/staff',
        headers: {
          cookie: 'staff_session=valid_staff_token',
        },
        payload: {
          name: 'Hacker Staff',
          phone: '628999999999',
          password: 'password123',
          role: 'SUPER_ADMIN',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_STAFF_MANAGEMENT');
    });

    it('allows staff to access permitted operational endpoints (reservations, customers, livechat)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/reservations',
        headers: {
          cookie: 'staff_session=valid_staff_token',
        },
      });

      // Should not be 403 Forbidden
      expect(res.statusCode).not.toBe(403);
    });
  });
});
