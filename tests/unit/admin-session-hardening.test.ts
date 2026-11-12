import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import {
  AdminSessionService,
  DEFAULT_ADMIN_SESSION_TTL_MS,
  resolveAdminSessionTtlMs,
} from '../../src/services/admin-session.service';

/**
 * S-011 — hardening sesi admin & header dashboard.
 *
 * Yang dijaga:
 * 1. TTL sesi default 7 hari (bukan 30 hari) dan bisa diatur 1–720 jam;
 *    nilai env tidak sah kembali ke default, tidak pernah "sesi abadi".
 * 2. `/admin/*` selalu membawa CSP + header keamanan saat diserve Fastify
 *    (defense-in-depth; Caddy juga menambahkannya di produksi).
 * 3. CSP tidak lagi memuat `'unsafe-eval'` atau `https:` bebas di script-src.
 */

const oldTtl = process.env.ADMIN_SESSION_TTL_HOURS;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ADMIN_SESSION_TTL_HOURS;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (oldTtl === undefined) delete process.env.ADMIN_SESSION_TTL_HOURS;
  else process.env.ADMIN_SESSION_TTL_HOURS = oldTtl;
});

describe('resolveAdminSessionTtlMs', () => {
  it('default 7 hari bila env tidak diisi', () => {
    expect(resolveAdminSessionTtlMs(undefined)).toBe(DEFAULT_ADMIN_SESSION_TTL_MS);
    expect(DEFAULT_ADMIN_SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('menerima override 1–720 jam', () => {
    expect(resolveAdminSessionTtlMs('24')).toBe(24 * 60 * 60 * 1000);
    expect(resolveAdminSessionTtlMs('720')).toBe(720 * 60 * 60 * 1000);
  });

  it('nilai tidak sah kembali ke default (tidak pernah sesi abadi)', () => {
    for (const raw of ['0', '-5', '721', 'abc', '', 'NaN']) {
      expect(resolveAdminSessionTtlMs(raw)).toBe(DEFAULT_ADMIN_SESSION_TTL_MS);
    }
  });
});

describe('createSession memakai TTL baru', () => {
  it('sesi baru kedaluwarsa ~7 hari (bukan 30 hari)', async () => {
    vi.spyOn(prisma.adminSession, 'create').mockRejectedValue(new Error('Database offline'));

    const session = await AdminSessionService.createSession('Admin Test');
    const ttl = session.expiresAt.getTime() - session.createdAt.getTime();

    expect(ttl).toBe(DEFAULT_ADMIN_SESSION_TTL_MS);
    expect(ttl).toBeLessThan(30 * 24 * 60 * 60 * 1000);
  });
});

describe('header keamanan /admin/*', () => {
  const app = buildApp();

  it('respons /admin/* membawa CSP tanpa unsafe-eval', async () => {
    // Status boleh 404 bila dist dashboard belum dibuild; header tetap wajib ada.
    const res = await app.inject({ method: 'GET', url: '/admin/' });
    const csp = String(res.headers['content-security-policy'] || '');

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('route non-admin tidak diberi CSP dashboard (tidak bocor ke webhook/API)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('Caddyfile produksi juga tidak lagi memakai unsafe-eval/https: bebas', () => {
    const caddy = fs.readFileSync(path.join(process.cwd(), 'Caddyfile'), 'utf8');
    const cspLine =
      caddy.split(/\r?\n/).find((line) => line.trim().startsWith('Content-Security-Policy')) || '';
    expect(cspLine).toContain("object-src 'none'");
    expect(cspLine).toContain("base-uri 'self'");
    expect(cspLine).not.toContain("'unsafe-eval'");
    expect(cspLine).not.toMatch(/script-src [^;]*\bhttps:/);
  });
});
