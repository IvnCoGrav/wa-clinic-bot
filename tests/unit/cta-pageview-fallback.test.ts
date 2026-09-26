import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { memoryPageViews } from '../../src/routes/tracking.route';

/**
 * Fase 3b (issue #136): fallback PageView `source='cta-fallback'` di GET /cta.
 * Kontrak: klik CTA TANPA beacon tercatat tidak boleh membuat views = 0.
 * Gate deterministik (data-state, bukan string-matching intent):
 *   - Tracker (external-tracker.js) SELALU menstempel `landing_url` ke link /cta
 *     yang diprosesnya, dan saat itu beacon PageView ikut terkirim di boot.
 *     → Klik TANPA `landing_url` = LP tanpa tracker / link manual → sintesis view.
 *   - Klik DENGAN `landing_url` = tracker aktif → beacon sudah ada → JANGAN sintesis.
 *   - Dedup: fbclid sama sudah tercatat (race klik-dini / beacon tanpa landing_url)
 *     → jangan buat baris kedua.
 *   - Test/is_test tidak menyintesis view (anti-polusi).
 */
describe('CTA PageView Fallback (Fase 3b)', () => {
  const app = buildApp();

  beforeEach(() => {
    memoryPageViews.clear();
    vi.restoreAllMocks();
    (prisma as any).landingPageView = {
      create: vi.fn().mockResolvedValue({ id: 'lpv_new' }),
      findFirst: vi.fn().mockResolvedValue(null),
    };
  });

  it('1. klik TANPA landing_url & tanpa beacon tercatat → sintesis view source=cta-fallback', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cta?phone=6281234567890&fbclid=FBTEST1',
      headers: { 'user-agent': 'Mozilla/5.0 (Android 14)' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('wa.me');
    expect((prisma as any).landingPageView.findFirst).toHaveBeenCalledWith({
      where: { tenant_id: expect.any(String), fbclid: 'FBTEST1' },
    });
    expect((prisma as any).landingPageView.create).toHaveBeenCalledTimes(1);
    expect((prisma as any).landingPageView.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'cta-fallback',
        eventId: null,
        fbclid: 'FBTEST1',
        userAgent: 'Mozilla/5.0 (Android 14)',
        landingUrl: expect.stringContaining('http'),
      }),
    });
  });

  it('2. fbclid sama sudah tercatat di landing_page_views → TIDAK sintesis (dedup)', async () => {
    vi.mocked((prisma as any).landingPageView.findFirst).mockResolvedValueOnce({ id: 'lpv-existing' } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/cta?phone=6281234567890&fbclid=FBTEST1',
      headers: { 'user-agent': 'Mozilla/5.0 (Android 14)' },
    });
    expect(res.statusCode).toBe(200);
    expect((prisma as any).landingPageView.create).not.toHaveBeenCalled();
  });

  it('3. klik DENGAN landing_url (tracker aktif → beacon pasti terkirim) → TIDAK sintesis', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/cta?phone=6281234567890&landing_url=${encodeURIComponent('https://lp.example.com/promo?a=1')}`,
      headers: { 'user-agent': 'Mozilla/5.0 (Android 14)' },
    });
    expect(res.statusCode).toBe(200);
    expect((prisma as any).landingPageView.findFirst).not.toHaveBeenCalled();
    expect((prisma as any).landingPageView.create).not.toHaveBeenCalled();
  });

  it('4. klik tanpa landing_url tapi TANPA fbclid → tetap sintesis (tanpa dedup key yang andal)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cta?phone=6281234567890',
      headers: { 'user-agent': 'Mozilla/5.0 (Android 14)' },
    });
    expect(res.statusCode).toBe(200);
    // Tanpa fbclid tidak ada kunci dedup andal (IP semua visitor = IP proxy di
    // belakang Caddy, KNOWN_ISSUES #129) → langsung sintesis, tanpa query verifikasi.
    expect((prisma as any).landingPageView.findFirst).not.toHaveBeenCalled();
    expect((prisma as any).landingPageView.create).toHaveBeenCalledTimes(1);
    expect((prisma as any).landingPageView.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: 'cta-fallback', fbclid: null }),
    });
  });

  it('5. bot diabaikan (tidak ada sintesis) & /cta tetap 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cta?phone=6281234567890',
      headers: { 'user-agent': 'facebookexternalhit/1.1' },
    });
    expect(res.statusCode).toBe(200);
    expect((prisma as any).landingPageView.create).not.toHaveBeenCalled();
  });

  it('6. mode test (?test=1) tidak menyintesis view (anti-polusi data)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cta?phone=6281234567890&test=1',
      headers: { 'user-agent': 'Mozilla/5.0 (Android 14)' },
    });
    expect(res.statusCode).toBe(200);
    expect((prisma as any).landingPageView.create).not.toHaveBeenCalled();
  });

  it('7. DB offline → fail-open: /cta tetap 200 dan view jatuh ke memoryPageViews', async () => {
    vi.mocked((prisma as any).landingPageView.findFirst).mockRejectedValueOnce(new Error('Database offline') as any);
    vi.mocked((prisma as any).landingPageView.create).mockRejectedValueOnce(new Error('Database offline') as any);

    const res = await app.inject({
      method: 'GET',
      url: '/cta?phone=6281234567890&fbclid=FBX',
      headers: { 'user-agent': 'Mozilla/5.0 (Android 14)' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('wa.me');
    expect(memoryPageViews.size).toBe(1);
    expect(Array.from(memoryPageViews.values())[0]).toMatchObject({ source: 'cta-fallback' });
  });
});
