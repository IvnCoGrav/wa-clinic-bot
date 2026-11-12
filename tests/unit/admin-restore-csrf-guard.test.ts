import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '../../src/app';
import { checkStateChangingCsrf, normalizeHost } from '../../src/utils/csrf-guard';

/** S-008: gerbang anti-CSRF/session-fixation pada restore sesi admin. */
describe('checkStateChangingCsrf (S-008)', () => {
  it('menolak request tanpa header AJAX (form lintas situs)', () => {
    expect(checkStateChangingCsrf({ host: 'app.example.com' })).toMatchObject({
      ok: false,
      code: 'CSRF_HEADER_REQUIRED',
    });
  });

  it('menolak header AJAX palsu dengan nilai lain', () => {
    expect(
      checkStateChangingCsrf({ host: 'app.example.com', 'x-requested-with': 'fetch' })
    ).toMatchObject({ ok: false, code: 'CSRF_HEADER_REQUIRED' });
  });

  it('menerima request AJAX same-origin', () => {
    expect(
      checkStateChangingCsrf({
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-requested-with': 'XMLHttpRequest',
      })
    ).toEqual({ ok: true });
  });

  it('menerima same-origin dengan port non-default & x-forwarded-host', () => {
    expect(
      checkStateChangingCsrf({
        host: '127.0.0.1:3001',
        'x-forwarded-host': 'clinic.example.com',
        origin: 'https://clinic.example.com',
        'x-requested-with': 'XMLHttpRequest',
      })
    ).toEqual({ ok: true });
  });

  it('menolak origin lintas situs (session fixation)', () => {
    expect(
      checkStateChangingCsrf({
        host: 'app.example.com',
        origin: 'https://evil.example.net',
        'x-requested-with': 'XMLHttpRequest',
      })
    ).toMatchObject({ ok: false, code: 'CSRF_ORIGIN_MISMATCH' });
  });

  it('menolak referer lintas situs bila origin tidak ada', () => {
    expect(
      checkStateChangingCsrf({
        host: 'app.example.com',
        referer: 'https://evil.example.net/panel',
        'x-requested-with': 'XMLHttpRequest',
      })
    ).toMatchObject({ ok: false, code: 'CSRF_ORIGIN_MISMATCH' });
  });

  it('menghormati allowlist ADMIN_ALLOWED_ORIGINS', () => {
    process.env.ADMIN_ALLOWED_ORIGINS = 'https://dashboard.example.org';
    try {
      expect(
        checkStateChangingCsrf({
          host: 'api.example.com',
          origin: 'https://dashboard.example.org',
          'x-requested-with': 'XMLHttpRequest',
        })
      ).toEqual({ ok: true });
    } finally {
      delete process.env.ADMIN_ALLOWED_ORIGINS;
    }
  });

  it('normalizeHost menangani URL penuh dan default port', () => {
    expect(normalizeHost('https://App.Example.com:443')).toBe('app.example.com');
    expect(normalizeHost('http://localhost:3001')).toBe('localhost:3001');
    expect(normalizeHost('')).toBe('');
  });
});

describe('POST /api/admin/auth/restore — gerbang CSRF (S-008)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = 'test_admin_key_csrf_restore';
    app = buildApp();
    await app.ready();
  });

  it('tanpa header AJAX → 403 CSRF_HEADER_REQUIRED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/restore',
      payload: { token: 'a'.repeat(64) },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('CSRF_HEADER_REQUIRED');
  });

  it('origin lintas situs → 403 CSRF_ORIGIN_MISMATCH', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/restore',
      headers: {
        host: 'app.example.com',
        origin: 'https://evil.example.net',
        'x-requested-with': 'XMLHttpRequest',
      },
      payload: { token: 'b'.repeat(64) },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('CSRF_ORIGIN_MISMATCH');
  });

  it('menerima token dari cookie sesi (tanpa body) → tidak 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/restore',
      headers: {
        cookie: `admin_session=${'c'.repeat(64)}`,
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    // DB offline di test: 503 atau 401 sah; yang dilarang adalah 400 "Token wajib diisi".
    expect(res.statusCode).not.toBe(400);
  });
});
