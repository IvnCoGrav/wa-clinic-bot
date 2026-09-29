import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { clearScopeCache } from '../../src/services/role-scope.service';
import { webPushService } from '../../src/services/web-push.service';
import { prisma } from '../../src/db/client';

/**
 * Remediasi kebocoran notifikasi Admin -> perangkat Terapis.
 * Menguji: RBAC scope push (data-driven), pemaksaan identitas langganan dari sesi,
 * caller-check test-staff, dan sanitasi cookie silang antar portal.
 * Offline: seluruh Prisma call default reject (tests/setup.ts) → fallback memori.
 */
describe('Push RBAC & Session Isolation (ghost subscription remediation)', () => {
  const app = buildApp();
  const superAdminKey = 'test_push_rbac_super_key';

  const THERAPIST_ID = '2eef2d61-747d-4756-a93f-512ee1d16f81';
  const OTHER_STAFF_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  const staffCookie = { cookie: 'staff_session=valid_staff_token', 'x-requested-with': 'XMLHttpRequest' };

  // Scope rows hasil seed migrasi 20260930000000 (granular, tanpa endpoint sensitif).
  const THERAPIST_PUSH_SCOPE_ROWS = [
    { api_prefix: '/api/admin/push/public-key', methods: 'GET' },
    { api_prefix: '/api/admin/push/subscribe', methods: 'POST' },
    { api_prefix: '/api/admin/push/unsubscribe', methods: 'POST' },
  ];

  function mockTherapistSession() {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      staff: {
        id: THERAPIST_ID,
        tenant_id: 'default-tenant',
        name: 'Bidan Tabita',
        phone: '628123456789',
        role: 'THERAPIST',
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
        telegram_chat_id: null,
      },
      session: {
        id: 'sess-tabita',
        staff_id: THERAPIST_ID,
        token: 'valid_staff_token',
        expires_at: new Date(Date.now() + 86400000),
        created_at: new Date(),
      },
    } as any);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = superAdminKey;
    clearScopeCache();
    mockTherapistSession();
  });

  describe('1. RBAC scope push data-driven (tanpa bypass hardcode)', () => {
    it('therapist BOLEH GET /api/admin/push/public-key saat scope seed ada', async () => {
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue(THERAPIST_PUSH_SCOPE_ROWS),
      };

      const res = await app.inject({ method: 'GET', url: '/api/admin/push/public-key', headers: staffCookie });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(typeof res.json().publicKey).toBe('string');
    });

    it('therapist DITOLAK GET /api/admin/push/public-key saat prefix push TIDAK ada di scope (managed default-deny)', async () => {
      // Kondisi pra-migrasi: therapist managed (punya baris seed lama) TAPI tanpa prefix push.
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue([
          { api_prefix: '/api/admin/staff/me', methods: 'GET' },
          { api_prefix: '/api/admin/staff/profile', methods: 'GET' },
        ]),
      };

      const res = await app.inject({ method: 'GET', url: '/api/admin/push/public-key', headers: staffCookie });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_ROLE_SCOPE');
    });

    it('therapist TETAP diblokir di endpoint push sensitif /staff-device-counts', async () => {
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue(THERAPIST_PUSH_SCOPE_ROWS),
      };

      const res = await app.inject({ method: 'GET', url: '/api/admin/push/staff-device-counts', headers: staffCookie });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_ROLE_SCOPE');
    });

    it('therapist TETAP diblokir di endpoint push sensitif /test-staff (bukan self-registration)', async () => {
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue(THERAPIST_PUSH_SCOPE_ROWS),
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/push/test-staff',
        headers: staffCookie,
        payload: { staffId: THERAPIST_ID },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_ROLE_SCOPE');
    });
  });

  describe('2. Pemaksaan identitas langganan dari sesi (anti-spoofing)', () => {
    it('subscribe sebagai therapist tersimpan STAFF + staffId meski body mengirim ADMIN/userId palsu', async () => {
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue(THERAPIST_PUSH_SCOPE_ROWS),
      };
      const saveSpy = vi
        .spyOn(webPushService, 'saveSubscription')
        .mockResolvedValue({} as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/push/subscribe',
        headers: staffCookie,
        payload: {
          subscription: {
            endpoint: 'https://push.example.com/ghost-endpoint',
            keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          },
          // Upaya spoofing: staf mencoba mendaftar sebagai ADMIN.
          userType: 'ADMIN',
          userId: OTHER_STAFF_ID,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(saveSpy).toHaveBeenCalledTimes(1);
      const params = saveSpy.mock.calls[0][0] as any;
      expect(params.userType).toBe('STAFF');
      expect(params.userId).toBe(THERAPIST_ID);
      expect(params.userId).not.toBe(OTHER_STAFF_ID);
    });

    it('subscribe sebagai Super Admin (X-API-KEY) tersimpan ADMIN + user_id null', async () => {
      const saveSpy = vi
        .spyOn(webPushService, 'saveSubscription')
        .mockResolvedValue({} as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/push/subscribe',
        headers: { 'x-api-key': superAdminKey },
        payload: {
          subscription: {
            endpoint: 'https://push.example.com/admin-endpoint',
            keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          },
          userType: 'ADMIN',
        },
      });

      expect(res.statusCode).toBe(200);
      const params = saveSpy.mock.calls[0][0] as any;
      expect(params.userType).toBe('ADMIN');
      expect(params.userId ?? null).toBeNull();
    });
  });

  describe('3. Caller-check endpoint test-staff', () => {
    it('therapist DITOLAK mengirim test-staff ke staf LAIN', async () => {
      // Scope dibuat permisif agar request mencapai handler (menguji guard handler, bukan scope).
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue([{ api_prefix: '/api/admin/push', methods: '*' }]),
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/push/test-staff',
        headers: staffCookie,
        payload: { staffId: OTHER_STAFF_ID },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_PUSH_TARGET');
    });

    it('therapist BOLEH mengirim test-staff ke dirinya sendiri', async () => {
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue([{ api_prefix: '/api/admin/push', methods: '*' }]),
      };
      vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 1, failed: 0 });

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/push/test-staff',
        headers: staffCookie,
        payload: { staffId: THERAPIST_ID },
      });

      expect(res.statusCode).toBe(200);
    });

    it('Super Admin (tanpa staffId) TETAP boleh mengirim test-staff ke staf mana pun', async () => {
      vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 1, failed: 0 });

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/push/test-staff',
        headers: { 'x-api-key': superAdminKey },
        payload: { staffId: OTHER_STAFF_ID },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('4. Dual-cookie: sesi staf MENANG atas sisa admin_session (fix ghost push)', () => {
    it('subscribe dengan KEDUA cookie (staff valid + admin lama) tetap tercatat STAFF + staffId', async () => {
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue(THERAPIST_PUSH_SCOPE_ROWS),
      };
      // Sesi admin lama masih valid di server — dulu ini yang menang diam-diam.
      const { AdminSessionService } = await import('../../src/services/admin-session.service');
      vi.spyOn(AdminSessionService, 'validateSession').mockResolvedValue({
        id: 'admin-sess-1',
        token: 'stale_admin_token',
        adminIdentity: 'admin@kalamomsspa.com',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      } as any);

      const saveSpy = vi.spyOn(webPushService, 'saveSubscription').mockResolvedValue({} as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/push/subscribe',
        headers: {
          cookie: 'admin_session=stale_admin_token; staff_session=valid_staff_token',
          'x-requested-with': 'XMLHttpRequest',
        },
        payload: {
          subscription: {
            endpoint: 'https://push.example.com/dual-cookie-endpoint',
            keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(saveSpy).toHaveBeenCalledTimes(1);
      const params = saveSpy.mock.calls[0][0] as any;
      expect(params.userType).toBe('STAFF');
      expect(params.userId).toBe(THERAPIST_ID);
    });
  });

  describe('5. Sanitasi cookie silang antar portal', () => {
    it('login staf menyertakan penghapusan cookie admin_session', async () => {
      vi.spyOn(StaffAuthService, 'login').mockResolvedValue({
        token: 'new_staff_token',
        expiresAt: new Date(Date.now() + 86400000),
        staff: {
          id: THERAPIST_ID,
          tenant_id: 'default-tenant',
          name: 'Bidan Tabita',
          phone: '628123456789',
          role: 'THERAPIST',
          active: true,
        },
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/staff/auth/login',
        payload: { phone: '628123456789', password: 'secret' },
      });

      expect(res.statusCode).toBe(200);
      const setCookie = ([] as string[]).concat(res.headers['set-cookie'] as any).join(';');
      expect(setCookie).toContain('staff_session=new_staff_token');
      expect(setCookie).toContain('admin_session=;');
    });

    it('login admin menyertakan penghapusan cookie staff_session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/auth/login',
        payload: { identifier: 'super@admin.com', password: superAdminKey },
      });

      expect(res.statusCode).toBe(200);
      const setCookie = ([] as string[]).concat(res.headers['set-cookie'] as any).join(';');
      expect(setCookie).toContain('admin_session=');
      expect(setCookie).toContain('staff_session=;');
    });
  });
});
