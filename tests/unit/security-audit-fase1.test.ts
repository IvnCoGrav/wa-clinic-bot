import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { memoryAdClicks } from '../../src/routes/tracking.route';

/**
 * SEC-AUDIT Fase 1 — uji adversarial parafrase-nyata, bukan happy-path:
 * BOLA pairing, traversal avatar, /ready generik, tracking origin+IP.
 */
describe('Security Audit Fase 1 (fail-open & guard murah)', () => {
  const app = buildApp();
  const superAdminKey = 'test_sec_audit_fase1_key';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = superAdminKey;
    memoryAdClicks.clear();
  });

  describe('1-2 BOLA token pairing Telegram staf', () => {
    const mockTherapist = (id: string) =>
      vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
        staff: {
          id,
          tenant_id: 'default-tenant',
          name: 'Terapis A',
          phone: '628111',
          role: 'THERAPIST',
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
          telegram_chat_id: null,
        },
        session: { id: 's', staff_id: id, token: 't', expires_at: new Date(Date.now() + 86400000), created_at: new Date() },
      } as any);

    it('staf A dilarang membaca pairing milik staf B (403 FORBIDDEN_STAFF_PAIRING)', async () => {
      mockTherapist('staff-A');
      // Loloskan lapis scope (2-2) agar lapis object-check (1-2) yang diuji.
      const { prisma } = await import('../../src/db/client');
      const { clearScopeCache } = await import('../../src/services/role-scope.service');
      clearScopeCache();
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue([
          { api_prefix: '/api/admin/staff/', methods: 'GET' },
        ]),
      };
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/staff/staff-B/telegram-pairing',
        headers: { cookie: 'staff_session=token-A' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_STAFF_PAIRING');
    });

    it('staf boleh membaca pairing miliknya sendiri bila scope mengizinkan (lapis 1-2 + 2-2)', async () => {
      mockTherapist('staff-A');
      // SEC-AUDIT-04: pasang scope baris (DBbreason offline → fail-closed tanpa ini).
      const { prisma } = await import('../../src/db/client');
      const { clearScopeCache } = await import('../../src/services/role-scope.service');
      clearScopeCache();
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue([
          { api_prefix: '/api/admin/staff/', methods: 'GET' },
        ]),
      };
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/staff/staff-A/telegram-pairing',
        headers: { cookie: 'staff_session=token-A' },
      });
      expect(res.statusCode).not.toBe(403);
    });

    it('super admin (API key) tetap boleh (tidak 403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/staff/staff-B/telegram-pairing',
        headers: { 'x-api-key': superAdminKey },
      });
      expect(res.statusCode).not.toBe(403);
    });
  });

  describe('1-3 traversal avatar dikurung di direktori', () => {
    const avatarDir = path.join(process.cwd(), 'storage', 'media', 'avatars');
    const marker = `PROBE-OUTSIDE-${Date.now()}`;
    const outsideFile = path.join(process.cwd(), 'storage', 'probe-outside.jpg');

    beforeEach(() => {
      fs.mkdirSync(avatarDir, { recursive: true });
      fs.writeFileSync(outsideFile, marker, 'utf-8');
    });

    afterEach(() => {
      fs.rmSync(outsideFile, { force: true });
    });

    it('payload ../ tidak membocorkan file .jpg di luar avatars', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/media/avatar/..%2Fprobe-outside',
      });
      // basename mengurung ke avatars/probe-outside.jpg (tak ada) → fallback,
      // bukan isi file luar direktori.
      expect(res.payload).not.toContain(marker);
    });

    it('variasi traversal berlapis tetap terkurung', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/media/avatar/..%2F..%2Fprobe-outside.jpg',
      });
      expect(res.payload).not.toContain(marker);
    });
  });

  describe('1-5 /ready tanpa bocoran error mentah', () => {
    it('DB down → pesan generik, tanpa detail error mock', async () => {
      const res = await app.inject({ method: 'GET', url: '/ready' });
      const body = res.json();
      expect(body.checks.database).toBe('FAILED: Database unavailable');
      expect(res.payload).not.toContain('Database offline');
    });
  });

  describe('1-6 tracking origin + anti-spoof IP', () => {
    const clickUrl = '/api/tracking/click';
    const sameOrigin = { host: 'klinik.test', origin: 'http://klinik.test/promo/hebat' };

    beforeEach(() => {
      process.env.TRACKING_API_KEY = 'test_tracking_key_15';
    });

    afterEach(() => {
      delete process.env.TRACKING_API_KEY;
    });

    const postClick = (headers: Record<string, string>, body: any = {}) =>
      app.inject({ method: 'POST', url: clickUrl, headers, payload: body });

    it('origin asing tanpa key → 401 (bypass http:// ditutup)', async () => {
      const res = await postClick({ host: 'klinik.test', origin: 'http://evil.com/landing' });
      expect(res.statusCode).toBe(401);
    });

    it('tanpa origin tanpa key → 401', async () => {
      const res = await postClick({ host: 'klinik.test' });
      expect(res.statusCode).toBe(401);
    });

    it('same-origin tanpa key → 200 (landing server sendiri tetap jalan)', async () => {
      const res = await postClick(sameOrigin);
      expect(res.statusCode).toBe(200);
      expect(res.json().trackingCode).toBeTruthy();
    });

    it('key valid dari origin asing → 200', async () => {
      const res = await postClick(
        { host: 'klinik.test', origin: 'http://evil.com/x', 'x-tracking-api-key': 'test_tracking_key_15' },
      );
      expect(res.statusCode).toBe(200);
    });

    it('key salah → 401', async () => {
      const res = await postClick(
        { ...sameOrigin, 'x-tracking-api-key': 'salah' },
      );
      expect(res.statusCode).toBe(401);
    });

    it('cookie _fbi palsu diabaikan — IP tercatat = socket peer', async () => {
      const res = await postClick({
        ...sameOrigin,
        cookie: '_fbi=9.9.9.9.1234567890.1; other=1',
      });
      expect(res.statusCode).toBe(200);
      const records = Array.from(memoryAdClicks.values());
      expect(records.length).toBeGreaterThan(0);
      const last = records[records.length - 1];
      expect(last.ipAddress).toBe('127.0.0.1');
      expect(last.ipAddress).not.toContain('9.9.9.9');
    });
  });

  describe('2-3 prefix guard integrasi Google (super-admin only)', () => {
    it('staf THERAPIST dilarang akses /api/admin/integrations/google/* (403)', async () => {
      vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
        staff: {
          id: 'staff-A',
          tenant_id: 'default-tenant',
          name: 'Terapis A',
          phone: '628111',
          role: 'THERAPIST',
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
          telegram_chat_id: null,
        },
        session: { id: 's', staff_id: 'staff-A', token: 't', expires_at: new Date(Date.now() + 86400000), created_at: new Date() },
      } as any);
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/integrations/google/status',
        headers: { cookie: 'staff_session=token-A' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_STAFF_ROLE');
    });
  });
});
