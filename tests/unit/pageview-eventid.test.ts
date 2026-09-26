import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { memoryPageViews } from '../../src/routes/tracking.route';

/**
 * Fase 2 — Kontrak persistensi PageView:
 * - `eventId` (eventID kembar browser↔CAPI) WAJIB disimpan agar view bisa
 *   di-join/dedup dengan Pixel & AdClick (sebelumnya hanya diteruskan ke CAPI).
 * - `source` menandai asal baris (beacon | cta-fallback | backfill-synthetic).
 * - `referrer` disimpan (dikirim external-tracker.js tapi sempat dibuang).
 * - Idempoten: insert duplikat eventID → P2002 ditangani sebagai deduped
 *   (bukan jatuh ke memory fallback yang menduplikasi baris).
 * - DB offline → memoryPageViews fail-open, key = eventId bila ada.
 */
describe('PageView EventID & Source — persistensi idempoten (Fase 2)', () => {
  const app = buildApp();

  beforeEach(() => {
    memoryPageViews.clear();
    vi.restoreAllMocks();
    // Simulasi DB ONLINE untuk landing_page_views (mock global tidak punya model ini)
    (prisma as any).landingPageView = { create: vi.fn().mockResolvedValue({ id: 'lpv_1' }) };
  });

  it('1. POST /pageview menyimpan eventId, source=beacon, dan referrer ke DB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tracking/pageview',
      headers: { 'user-agent': 'Mozilla/5.0 (Android 14)' },
      payload: {
        eventID: 'pv_1711_abc123',
        referrer: 'https://www.facebook.com/',
        landingUrl: 'https://kalababyspa.online/reservasionline',
        fbclid: 'fb_test',
        utm_source: 'meta',
        utm_campaign: 'promo-a',
        tenantId: 'default-tenant',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);

    const createMock = (prisma as any).landingPageView.create;
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: 'pv_1711_abc123',
        source: 'beacon',
        referrer: 'https://www.facebook.com/',
        tenant_id: 'default-tenant',
        landingUrl: 'https://kalababyspa.online/reservasionline',
      }),
    });
    // Sukses DB → tidak boleh jatuh ke memory
    expect(memoryPageViews.size).toBe(0);
  });

  it('2. Duplikat eventID → P2002 ditangani sebagai deduped, TANPA baris memory', async () => {
    (prisma as any).landingPageView.create.mockRejectedValueOnce({ code: 'P2002' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tracking/pageview',
      headers: { 'user-agent': 'Mozilla/5.0 (Android 14)' },
      payload: { eventID: 'pv_dup', landingUrl: 'https://example.com', tenantId: 'default-tenant' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.deduped).toBe(true);
    // Dedup bukan "DB offline" — tidak boleh mengotori memory fallback
    expect(memoryPageViews.size).toBe(0);
  });

  it('3. Tanpa eventID tetap tersimpan (eventId null) tanpa error & tanpa dedup', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tracking/pageview',
      headers: { 'user-agent': 'Mozilla/5.0 (Android 14)' },
      payload: { landingUrl: 'https://example.com', tenantId: 'default-tenant' },
    });
    expect(res.statusCode).toBe(200);
    const createMock = (prisma as any).landingPageView.create;
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventId: null, source: 'beacon' }),
    });
    expect(memoryPageViews.size).toBe(0);
  });

  it('4. DB offline (model tak ada/throw) → fail-open ke memoryPageViews dengan key=eventId', async () => {
    (prisma as any).landingPageView = { create: vi.fn().mockRejectedValue(new Error('Database offline')) };

    const res = await app.inject({
      method: 'POST',
      url: '/api/tracking/pageview',
      headers: { 'user-agent': 'Mozilla/5.0 (Android 14)' },
      payload: { eventID: 'pv_offline_1', landingUrl: 'https://example.com', tenantId: 'default-tenant' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
    expect(memoryPageViews.size).toBe(1);
    expect(memoryPageViews.has('pv_offline_1')).toBe(true);
    expect(memoryPageViews.get('pv_offline_1')).toMatchObject({ source: 'beacon', tenant_id: 'default-tenant' });
  });

  it('5. Klien retry dengan eventID sama saat DB pulih → deduped, memory tidak terisi', async () => {
    // DB offline dulu (memory terisi) — lalu retry sukses ke DB: memory TIDAK diisi lagi
    (prisma as any).landingPageView = { create: vi.fn().mockRejectedValueOnce(new Error('Database offline')) };
    await app.inject({
      method: 'POST',
      url: '/api/tracking/pageview',
      headers: { 'user-agent': 'Mozilla/5.0 (Android 14)' },
      payload: { eventID: 'pv_retry', landingUrl: 'https://example.com', tenantId: 'default-tenant' },
    });
    expect(memoryPageViews.size).toBe(1);

    // Retry: DB pulih, ternyata eventID sudah pernah masuk → P2002 → deduped
    (prisma as any).landingPageView = {
      create: vi.fn().mockRejectedValueOnce({ code: 'P2002' }),
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/tracking/pageview',
      headers: { 'user-agent': 'Mozilla/5.0 (Android 14)' },
      payload: { eventID: 'pv_retry', landingUrl: 'https://example.com', tenantId: 'default-tenant' },
    });
    expect(JSON.parse(res.body).deduped).toBe(true);
    expect(memoryPageViews.size).toBe(1); // tidak bertambah jadi 2
  });
});
