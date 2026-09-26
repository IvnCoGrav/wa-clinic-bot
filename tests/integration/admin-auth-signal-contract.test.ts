import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

/**
 * Kontrak HTTP sinyal sesi admin (anti-logout-paksa pasca-sec-audit a7c3dc30).
 *
 * Skenario nyata yang direplikasi: database lambat/jenuh saat dashboard
 * memanggil /me atau /restore. Sebelum fix, validateSession() → null →
 * 401 ambigu → frontend menghapus token cadangan → user ditendang walau
 * sesi 30-hari di DB sah.
 *
 * Kontrak yang dijaga:
 * - DB tak tersedia → 503 + code SESSION_STORE_UNAVAILABLE (frontend: retry)
 * - DB sehat + token tak dikenal → 401 (frontend: logout bersih)
 * - DB sehat + sesi valid → 200; panggilan berulang dilayani hot cache
 * - Media privat saat DB mati → 401 deny (bukan 500)
 */
const uniqToken = () => crypto.randomBytes(32).toString('hex');

describe('Kontrak HTTP sinyal sesi admin (503 vs 401)', () => {
  const app = buildApp();

  beforeEach(() => {
    process.env.ADMIN_API_KEY = 'test_admin_key_signal_contract';
  });

  describe('GET /api/admin/auth/me', () => {
    it('DB sesi error → 503 SESSION_STORE_UNAVAILABLE (bukan 401 ambigu)', async () => {
      (prisma.adminSession.findUnique as any).mockRejectedValue(
        new Error('connection pool timeout')
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/auth/me',
        headers: { cookie: `admin_session=${uniqToken()}` },
      });

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).code).toBe('SESSION_STORE_UNAVAILABLE');
    });

    it('DB sehat, token tak dikenal → 401 (penolakan jujur)', async () => {
      (prisma.adminSession.findUnique as any).mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/auth/me',
        headers: { cookie: `admin_session=${uniqToken()}` },
      });

      expect(res.statusCode).toBe(401);
    });

    it('DB sehat, sesi valid → 200; permintaan berulang dilayani hot cache (1 query DB)', async () => {
      const store = new Map<string, any>();
      const token = uniqToken();
      const { hashAdminToken } = await import('../../src/services/admin-session.service');
      store.set(hashAdminToken(token), {
        id: 'adm-http-1',
        admin_identity: 'Signal Contract Tester',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
        revoked_at: null,
      });
      (prisma.adminSession.findUnique as any).mockImplementation(async ({ where }: any) =>
        store.get(where.token_hash) || null
      );

      const headers = { cookie: `admin_session=${token}` };
      const callsBefore = (prisma.adminSession.findUnique as any).mock.calls.length;
      const first = await app.inject({ method: 'GET', url: '/api/admin/auth/me', headers });
      const second = await app.inject({ method: 'GET', url: '/api/admin/auth/me', headers });

      expect(first.statusCode).toBe(200);
      expect(JSON.parse(first.body).user.name).toBe('Signal Contract Tester');
      expect(second.statusCode).toBe(200);
      // Panggilan ke-1 menembus DB; panggilan ke-2 dilayani hot cache (0 query).
      expect((prisma.adminSession.findUnique as any).mock.calls.length - callsBefore).toBe(1);
    });
  });

  describe('preHandler route admin (GET /api/admin/settings)', () => {
    it('cookie + DB error → 503, bukan 401', async () => {
      (prisma.adminSession.findUnique as any).mockRejectedValue(
        new Error('connection pool timeout')
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/settings',
        headers: { cookie: `admin_session=${uniqToken()}` },
      });

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).code).toBe('SESSION_STORE_UNAVAILABLE');
    });

    it('cookie tak dikenal + DB sehat → 401', async () => {
      (prisma.adminSession.findUnique as any).mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/settings',
        headers: { cookie: `admin_session=${uniqToken()}` },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/admin/auth/restore', () => {
    it('DB error → 503 (bukan 401 yang memicu penghapusan token frontend)', async () => {
      (prisma.adminSession.findUnique as any).mockRejectedValue(
        new Error('connection pool timeout')
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/auth/restore',
        payload: { token: uniqToken() },
      });

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).code).toBe('SESSION_STORE_UNAVAILABLE');
    });

    it('DB sehat + token tak dikenal → 401', async () => {
      (prisma.adminSession.findUnique as any).mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/auth/restore',
        payload: { token: uniqToken() },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('media privat (GET /media/inbound/...)', () => {
    it('DB error → deny 401 (bukan 500): media bukan jalur logout', async () => {
      (prisma.adminSession.findUnique as any).mockRejectedValue(
        new Error('connection pool timeout')
      );

      const res = await app.inject({
        method: 'GET',
        url: '/media/inbound/default-tenant/tidak-ada.png',
        headers: { cookie: `admin_session=${uniqToken()}` },
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
