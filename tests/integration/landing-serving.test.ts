import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

// Landing kini di-serve langsung oleh bot (port 3000 / domain utama), bukan click-catcher.
// Route baru: GET /go (fail-open generik), GET /promo/:slug & GET /:slug (strict 404 bila tak ada).

describe('Landing Serving di Bot — /go, /promo/:slug, /:slug (offline DB)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    process.env.TRACKING_API_KEY = 'test_tracking_key_serving';
    process.env.TRACKING_API_BASE_URL = '';
    process.env.FB_PIXEL_ID = '';
    process.env.DEFAULT_WHATSAPP_PHONE = '6287751148065';
  });

  const rawHtml = '<html><head><title>Promo</title></head><body><a id="wa-cta" href="#">Chat</a></body></html>';
  const rawHtmlWithEvents = '<html><head><title>Promo</title></head><body><a id="wa-cta" href="#">Chat</a></body></html>';

  it('1. GET /default-tenant RAW_HTML → 200 text/html + nonce CSP + pixel + events onload/click', async () => {
    vi.mocked(prisma.landingPage.findFirst).mockResolvedValueOnce({
      id: 'lp-1',
      tenant_id: 'default-tenant',
      slug: 'default-tenant',
      title: 'Landing Default',
      landing_type: 'RAW_HTML',
      html_content: rawHtmlWithEvents,
      structured_content: null,
      events: ['ViewContent', 'Lead'],
      meta_pixel_id: 'PIXEL_123',
      whatsapp_number: '628111',
      is_active: true,
    } as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'default-tenant',
      name: 'Klinik Kenanga',
      whatsapp_number: '628222',
      meta_pixel_id: 'TENANT_PIXEL',
    } as any);

    const res = await app.inject({ method: 'GET', url: '/default-tenant' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['content-security-policy'])).toContain('script-src');
    expect(String(res.headers['content-security-policy'])).toContain('frame-ancestors');

    const html = res.body;
    expect(html).toContain("fbq('init', 'PIXEL_123')");
    expect(html).toContain("fbq('track', 'PageView')");
    // events onload (ViewContent) + click events (Lead) ter-inject
    expect(html).toContain("fbq('track', 'ViewContent')");
    expect(html).toContain('"Lead"');
    // nonce pada script inline (CSP strict, tidak unsafe-inline)
    expect(html).toContain('<script nonce=');
  });

  it('2. GET /default-tenant STRUCTURED_JSON → template ter-render, placeholder tak bocor', async () => {
    vi.mocked(prisma.landingPage.findFirst).mockResolvedValueOnce({
      id: 'lp-2',
      tenant_id: 'default-tenant',
      slug: 'default-tenant',
      title: 'Template Sistem',
      landing_type: 'STRUCTURED_JSON',
      html_content: null,
      structured_content: { headline: 'Judul Template' },
      events: ['ViewContent', 'Lead'],
      meta_pixel_id: 'PIXEL_SYS',
      whatsapp_number: null,
      is_active: true,
    } as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce(null as any);

    const res = await app.inject({ method: 'GET', url: '/default-tenant' });
    expect(res.statusCode).toBe(200);

    const html = res.body;
    expect(html).toContain('<script nonce=');
    expect(html).toContain('Judul Template');
    expect(html).toContain('id="wa-cta"');
    expect(html).toContain("fbq('init', 'PIXEL_SYS')");
    expect(html).toContain("fbq('track', 'ViewContent')");
    // tracking same-origin: base kosong → fetch relatif
    expect(html).toContain("'/api/tracking/click'");
    // tidak ada placeholder yang bocor
    expect(html).not.toContain('__HEADLINE__');
    expect(html).not.toContain('__BENEFITS_HTML__');
    expect(html).not.toContain('__EVENTS_ONLOAD__');
  });

  it('3. GET /promo/:slug → 404 ketat saat landing tak ada', async () => {
    const res = await app.inject({ method: 'GET', url: '/promo/tidak-ada' });
    expect(res.statusCode).toBe(404);
  });

  it('4. GET /:slug tak dikenal → 404 ketat (bukan fail-open)', async () => {
    const res = await app.inject({ method: 'GET', url: '/promo-bay-typo' });
    expect(res.statusCode).toBe(404);
  });

  it('5. GET /favicon.ico (reserved) → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/favicon.ico' });
    expect(res.statusCode).toBe(404);
  });

  it('6. GET /go → 200 generik (fail-open, pintu masuk kampanye)', async () => {
    const res = await app.inject({ method: 'GET', url: '/go' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('id="wa-cta"');
  });

  it('7. Route lain tak terganggu: /health tetap 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('OK');
  });

  it('8. JSON API /api/tenant/:slug tetap fail-open (backward-compat)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tenant/promo-baby' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.events).toEqual([]);
    expect(body.slug).toBe('promo-baby');
    expect(body.meta_capi_access_token).toBeUndefined();
  });
});
