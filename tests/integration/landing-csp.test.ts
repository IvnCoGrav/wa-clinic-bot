import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';

/**
 * Task 0.7 — Kontrak Integrasi Header Keamanan /cta & CSP (Fase 1 Contract)
 * Status: MERAH sebelum implementasi Fase 1 (A-001).
 */
describe('Task 0.7: Landing /cta CSP & XFO Integration Contract (Fase 1)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.ADMIN_API_KEY = 'test_admin_key_csp';
    app = await buildApp();
  });

  afterEach(async () => {
    if (app) await app.close().catch(() => {});
  });

  it('1. GET /cta wajib memiliki CSP yang mengizinkan connect.facebook.net untuk AddToCart pixel', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cta?slug=pijat-bayi',
    });

    const csp = res.headers['content-security-policy'] as string | undefined;
    expect(csp).toBeDefined();
    expect(csp).toContain('connect.facebook.net');
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('2. GET /cta wajib memiliki X-Frame-Options: DENY', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cta?slug=pijat-bayi',
    });

    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('3. POST /api/csp-report wajib aktif untuk menerima laporan browser', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/csp-report',
      headers: {
        'content-type': 'application/csp-report',
      },
      payload: JSON.stringify({
        'csp-report': {
          'document-uri': 'https://landing.example.com/cta',
          'blocked-uri': 'http://evil.com/script.js',
          'violated-directive': 'script-src',
        },
      }),
    });

    // Sebelum Fase 1, endpoint ini 404
    expect(res.statusCode).toBe(204);
  });
});
