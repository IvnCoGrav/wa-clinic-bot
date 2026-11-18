import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { memoryAdClicks } from '../../src/routes/tracking.route';

describe('Task 1.7 + P0-5: Meta Pixel Health Probe Endpoint', () => {
  let app: FastifyInstance;
  const origPixel = process.env.FB_PIXEL_ID;
  const origPhone = process.env.DEFAULT_WHATSAPP_PHONE;

  beforeEach(async () => {
    vi.clearAllMocks();
    memoryAdClicks.clear();
    (prisma as any).landingPageView = {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'lpv_1' }),
    };
    process.env.ADMIN_API_KEY = 'test_admin_key_pixel_health';
    process.env.FB_PIXEL_ID = '1465457801784141';
    process.env.DEFAULT_WHATSAPP_PHONE = '6285794210526';
    app = await buildApp();
  });

  afterEach(async () => {
    if (origPixel === undefined) delete process.env.FB_PIXEL_ID;
    else process.env.FB_PIXEL_ID = origPixel;
    if (origPhone === undefined) delete process.env.DEFAULT_WHATSAPP_PHONE;
    else process.env.DEFAULT_WHATSAPP_PHONE = origPhone;
    if (app) await app.close().catch(() => {});
  });

  it('GET /api/admin/debug/meta-pixel-health mengembalikan status ok saat CSP, XFO, fbqInit, dan AddToCart valid TANPA membuat AdClick/PageView', async () => {
    const adClickCreateSpy = vi.mocked(prisma.adClick.create);
    const pvCreateSpy = vi.mocked((prisma as any).landingPageView.create);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/debug/meta-pixel-health',
      headers: {
        'x-api-key': 'test_admin_key_pixel_health',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.checks).toEqual({
      cspValid: true,
      xfoDeny: true,
      fbqInit: true,
      addToCart: true,
    });
    expect(body.headers['content-security-policy']).toContain('connect.facebook.net');
    expect(body.headers['x-frame-options']).toBe('DENY');

    // P0-5: Probe kesehatan DILARANG mencemari AdClick atau LandingPageView
    expect(memoryAdClicks.size).toBe(0);
    expect(adClickCreateSpy).not.toHaveBeenCalled();
    expect(pvCreateSpy).not.toHaveBeenCalled();
  });

  it('mengembalikan status degraded (bukan ok palsu) bila Pixel ID kosong sehingga fbqInit/AddToCart tidak ada', async () => {
    delete process.env.FB_PIXEL_ID;

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/debug/meta-pixel-health',
      headers: {
        'x-api-key': 'test_admin_key_pixel_health',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('degraded');
    expect(body.checks.fbqInit).toBe(false);
    expect(body.checks.addToCart).toBe(false);
    expect(memoryAdClicks.size).toBe(0);
  });
});
