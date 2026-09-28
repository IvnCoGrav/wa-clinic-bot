import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { SessionStoreUnavailable } from '../../src/services/admin-session.service';

/**
 * Observabilitas jalur auth (KNOWN_ISSUES #143): hook onResponse WAJIB
 * memancarkan baris `AUTH ACCESS` untuk 401/503 pada rute auth/admin/staff,
 * dan TIDAK memancarkannya untuk status sukses. Token penuh DILARANG bocor.
 */
const uniqToken = () => crypto.randomBytes(32).toString('hex');

describe('Access-log jalur auth (401/503) — #143', () => {
  const app = buildApp();

  beforeEach(() => {
    process.env.ADMIN_API_KEY = 'test_admin_key_auth_log';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureAuthLogs(): string[] {
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      const s = args.map(String).join(' ');
      if (s.includes('[AUTH ACCESS]')) lines.push(s);
    });
    return lines;
  }

  it('401 pada /api/admin/auth/me → tercatat sebagai AUTH ACCESS (signal 401)', async () => {
    (prisma.adminSession.findUnique as any).mockResolvedValue(null);
    const lines = captureAuthLogs();

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/auth/me',
      headers: { cookie: `admin_session=${uniqToken()}` },
    });

    expect(res.statusCode).toBe(401);
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0].replace('[AUTH ACCESS] ', ''));
    expect(entry.event).toBe('AUTH_ACCESS');
    expect(entry.signal).toBe('401');
    expect(entry.path).toBe('/api/admin/auth/me');
    expect(entry.status).toBe(401);
  });

  it('503 pada rute staff → tercatat sebagai AUTH ACCESS (signal 503)', async () => {
    const { StaffAuthService } = await import('../../src/services/staff-auth.service');
    vi.spyOn(StaffAuthService, 'validateSession').mockRejectedValue(new SessionStoreUnavailable());
    const lines = captureAuthLogs();

    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/today-tasks',
      headers: { cookie: 'staff_session=abc' },
    });

    expect(res.statusCode).toBe(503);
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0].replace('[AUTH ACCESS] ', ''));
    expect(entry.signal).toBe('503');
    expect(entry.path).toBe('/api/staff/today-tasks');
  });

  it('respons sukses (200) TIDAK menghasilkan baris AUTH ACCESS', async () => {
    const lines = captureAuthLogs();

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(lines.length).toBe(0);
  });

  it('token sesi penuh TIDAK pernah muncul di log (hanya hash prefix-8)', async () => {
    (prisma.adminSession.findUnique as any).mockResolvedValue(null);
    const lines = captureAuthLogs();
    const token = 'TOKEN_SANGAT_RAHASIA_123';

    await app.inject({
      method: 'GET',
      url: '/api/admin/auth/me',
      headers: { cookie: `admin_session=${token}` },
    });

    expect(lines.length).toBe(1);
    expect(lines[0]).not.toContain(token);
    const entry = JSON.parse(lines[0].replace('[AUTH ACCESS] ', ''));
    expect(entry.sessionHashPrefix8).toMatch(/^[0-9a-f]{8}$/);
  });
});
