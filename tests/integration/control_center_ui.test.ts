import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { AdminSessionService } from '../../src/services/admin-session.service';

describe('Modul 5.4 — Control Center UI & Origin Isolation Security Tests', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
  });

  it('1. Origin Isolation Guard: Accessing /admin/* on pages.kalababyspa.online MUST return 404 Not Found', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/human-handling-conversations',
      headers: {
        host: 'pages.kalababyspa.online',
        'x-api-key': 'test_admin_key_999',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error).toBe('Not Found');
  });

  it('2. Browser Admin Auth & Rate-Limiting: HttpOnly Cookie session issued on login, rate-limiting on brute-force', async () => {
    // 2a. Valid Login -> Sets HttpOnly Cookie
    const resLogin = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { password: 'test_admin_key_999', adminIdentity: 'Bidan Kenanga' },
    });

    expect(resLogin.statusCode).toBe(200);
    const setCookieHeader = resLogin.headers['set-cookie'] as string;
    expect(setCookieHeader).toContain('admin_session=');
    expect(setCookieHeader).toContain('HttpOnly');
    expect(setCookieHeader).toContain('SameSite=Strict');

    const sessionCookieToken = setCookieHeader.match(/admin_session=([^;]+)/)?.[1] || '';
    expect(sessionCookieToken.length).toBeGreaterThan(10);

    // 2b. Authenticated request using HttpOnly Cookie
    const resAuthCookie = await app.inject({
      method: 'GET',
      url: '/api/admin/auth/me',
      headers: {
        cookie: `admin_session=${sessionCookieToken}`,
      },
    });

    expect(resAuthCookie.statusCode).toBe(200);
    expect(JSON.parse(resAuthCookie.body).adminIdentity).toBe('Bidan Kenanga');

    // 2c. Authenticated request using S2S X-API-KEY header
    const resAuthHeader = await app.inject({
      method: 'GET',
      url: '/api/admin/auth/me',
      headers: {
        'x-api-key': 'test_admin_key_999',
        'x-admin-identity': 'External Script Client',
      },
    });

    expect(resAuthHeader.statusCode).toBe(200);
    expect(JSON.parse(resAuthHeader.body).adminIdentity).toBe('External Script Client');

    // 2d. Rate Limiting Test (Brute-force protection on /api/admin/auth/login)
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/admin/auth/login',
        payload: { password: 'wrong_password_attempt' },
      });
    }

    const resBlocked = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { password: 'wrong_password_attempt' },
    });

    expect(resBlocked.statusCode).toBe(429);
    expect(JSON.parse(resBlocked.body).error).toContain('Too Many Requests');
  });

  it('3. 3-Table Staging Review Flow: Fetch & Review endpoints for Medical, General, and Legacy Staging', async () => {
    // 3a. Medical Staging Review
    const resMed = await app.inject({
      method: 'GET',
      url: '/api/admin/medical-faq-staging',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(resMed.statusCode).toBe(200);

    // 3b. General Staging Review
    const resGen = await app.inject({
      method: 'GET',
      url: '/api/admin/general-faq-staging',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(resGen.statusCode).toBe(200);

    // 3c. Legacy Staging Commit
    const resLeg = await app.inject({
      method: 'GET',
      url: '/api/admin/legacy-staging',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(resLeg.statusCode).toBe(200);

    const resCommit = await app.inject({
      method: 'PATCH',
      url: '/api/admin/legacy-staging/stage_leg_123/commit',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { status: 'COMMITTED' },
    });
    expect(resCommit.statusCode).toBe(200);
  });
});
