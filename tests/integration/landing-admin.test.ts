import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';

describe('Landing Page Admin API — GET status, POST reset (offline/fallback)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    // Blank tracking env supaya purge cache (fire-and-forget) tidak mencoba jaringan
    process.env.TRACKING_API_BASE_URL = '';
    process.env.TRACKING_API_KEY = '';
    process.env.LANDING_BASE_URL = 'https://landing.example.com';
  });

  it('1. GET /api/admin/tenant/:id/landing tanpa auth harus 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/tenant/kenanga/landing' });
    expect(res.statusCode).toBe(401);
  });

  it('2. GET /api/admin/tenant/:id/landing mengembalikan status landing fail-open (DB offline → default)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/tenant/kenanga/landing',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe('kenanga');
    expect(body.data.landingType).toBe('STRUCTURED_JSON');
    expect(body.data.hasRawHtml).toBe(false);
    expect(body.data.rawHtmlContent).toBe('');
    expect(body.data.sizeBytes).toBe(0);
    expect(body.data.previewBaseUrl).toBe('https://landing.example.com');
  });

  it('3. POST /api/admin/tenant/:id/landing/reset tanpa auth harus 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tenant/kenanga/landing/reset',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('4. POST /api/admin/tenant/:id/landing/reset mengembalikan STRUCTURED_JSON (offline fallback)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tenant/kenanga/landing/reset',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.landingType).toBe('STRUCTURED_JSON');
  });

  it('5. GET previewBaseUrl jatuh ke TRACKING_API_BASE_URL kalau LANDING_BASE_URL kosong', async () => {
    process.env.LANDING_BASE_URL = '';
    process.env.TRACKING_API_BASE_URL = 'http://localhost:3000';

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/tenant/kenanga/landing',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    const body = JSON.parse(res.body);
    expect(body.data.previewBaseUrl).toBe('http://localhost:3000');
  });

  it('6. Upload PUT /html tetap berhasil (fallback) dan purge cache no-op saat tracking env kosong', async () => {
    const validHtml = '<html><head><title>Promo</title></head><body><a id="wa-cta" href="#">Chat WA</a></body></html>';

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/tenant/kenanga/html',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { rawHtml: validHtml },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.landingType).toBe('RAW_HTML');
  });
});
