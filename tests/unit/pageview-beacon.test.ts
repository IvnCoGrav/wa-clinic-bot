import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TenantHtmlService } from '../../src/services/html-sanitizer';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { memoryPageViews } from '../../src/routes/tracking.route';

/**
 * Fase 1 — Penyetaraan beacon LP internal.
 * Menguji bahwa RAW_HTML dan template terstruktur kini mengirim beacon server PageView
 * dengan eventID kembar (browser fbq + CAPI dedup), tenant-aware, dan idempoten.
 */
describe('PageView Beacon — LP Internal (Fase 1)', () => {
  const rawHtml = '<html><head><title>Promo</title></head><body><a id="wa-cta" href="#">Chat</a></body></html>';

  it('1. RAW_HTML injectTracking mengandung beacon /api/tracking/pageview dengan eventID kembar & tenantId', () => {
    const html = TenantHtmlService.injectTracking(
      rawHtml,
      'PIXEL_123',
      'nonce-abc',
      { trackingApiBaseUrl: '', trackingApiKey: '', whatsappNumber: '628123', tenantId: 'default-tenant', tenantSlug: 'promo-test' },
      ['ViewContent', 'Lead'],
    );

    // Beacon server ada
    expect(html).toContain('/api/tracking/pageview');
    // fbq PageView kini dengan eventID (bukan tanpa param)
    expect(html).toContain("fbq('track', 'PageView'");
    expect(html).toContain('eventID');
    // Keduanya memakai pvEventId yang sama — hitung kemunculan eventID: minimal 2 (fbq + beacon)
    const eventIdHits = (html.match(/eventID/g) || []).length;
    expect(eventIdHits).toBeGreaterThanOrEqual(2);
    // Anti-polusi tenant: tenantId dari config, bukan hardcode
    expect(html).toContain('default-tenant');
    // Guard idempoten
    expect(html).toContain('_kala_pageview_tracked');
    // CSP nonce tetap
    expect(html).toContain('nonce-abc');
    // keepalive/sendBeacon
    expect(html).toContain('sendBeacon');
    expect(html).toContain('keepalive');
    // Payload lengkap (parity dengan external-tracker.js)
    expect(html).toContain('fbclid');
    expect(html).toContain('utm_source');
  });

  it('2. RAW_HTML tanpa pixel tetap kirim beacon (beacon independen dari hasPixel)', () => {
    const html = TenantHtmlService.injectTracking(
      rawHtml,
      '', // tanpa pixel
      'nonce-xyz',
      { trackingApiBaseUrl: '', trackingApiKey: '', whatsappNumber: '628123', tenantId: 'tenant-a', tenantSlug: 'slug-a' },
      [],
    );
    // Tidak ada fbq init, tapi beacon tetap ada
    expect(html).not.toContain("fbq('init'");
    expect(html).toContain('/api/tracking/pageview');
    expect(html).toContain('tenant-a');
  });

  it('3. STRUCTURED_JSON /go juga mengandung beacon (via GET /go)', async () => {
    const app = buildApp();
    // Mock landingPage untuk /go fallback (structured)
    vi.mocked(prisma.landingPage.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.tenant.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

    const res = await app.inject({ method: 'GET', url: '/go' });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    expect(html).toContain('/api/tracking/pageview');
    expect(html).toContain("fbq('track', 'PageView'");
    expect(html).toContain('eventID');
    expect(html).toContain('_kala_pageview_tracked');
  });

  it('4. POST /api/tracking/pageview → DB offline tetap sukses (fail-open) dan tercatat di memoryPageViews', async () => {
    const app = buildApp();
    memoryPageViews.clear();
    // Prisma offline by default (tests/setup.ts mocks reject) — beacon harus tetap 200
    const res = await app.inject({
      method: 'POST',
      url: '/api/tracking/pageview',
      payload: {
        eventID: 'pv_test_123',
        landingUrl: 'https://kalababyspa.online/reservasionline',
        fbclid: 'fb_test_123',
        utm_source: 'meta',
        utm_campaign: 'promo-a',
        tenantId: 'default-tenant',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
    // Saat DB offline, fallback memoryPageViews terisi
    expect(memoryPageViews.size).toBeGreaterThanOrEqual(1);
  });

  it('5. Bot UA diabaikan — tidak menambah landing_page_views', async () => {
    const app = buildApp();
    const before = memoryPageViews.size;
    const res = await app.inject({
      method: 'POST',
      url: '/api/tracking/pageview',
      headers: { 'user-agent': 'facebookexternalhit/1.1' },
      payload: { eventID: 'pv_bot', landingUrl: 'https://example.com', tenantId: 'default-tenant' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ignored).toBe(true);
    // Tidak menambah entry baru (bot filtered)
    expect(memoryPageViews.size).toBe(before);
  });

  it('6. GET /cta langsung tetap buat AdClick tanpa butuh PageView (direct hit)', async () => {
    const app = buildApp();
    vi.mocked(prisma.tenant.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
    // landing_page_views kosong, tapi /cta harus tetap 200
    const res = await app.inject({
      method: 'GET',
      url: '/cta?phone=6281234567890',
      headers: { 'user-agent': 'Mozilla/5.0 (real user)' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('wa.me');
  });
});
