import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

describe('Zero-Preflight Plaintext Beacon & CORS (Fase 3)', () => {
  let app: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    (prisma as any).tenant = {
      findUnique: vi.fn().mockResolvedValue({
        id: 'default-tenant',
        slug: 'default',
        meta_pixel_id: '1234567890',
      }),
      findFirst: vi.fn().mockResolvedValue({
        id: 'default-tenant',
      }),
      findMany: vi.fn().mockResolvedValue([]),
    };
  });

  it('1. POST /api/tracking/pageview dengan Content-Type text/plain;charset=UTF-8 berhasil di-parse sebagai JSON dan disimpan lengkap', async () => {
    let capturedData: any = null;
    (prisma as any).landingPageView = {
      create: vi.fn().mockImplementation((args: any) => {
        capturedData = args?.data;
        return Promise.resolve({ id: 'lpv_plaintext_1' });
      }),
    };

    app = buildApp();

    const payloadObj = {
      eventID: 'pv_beacon_text_plain_1',
      landingUrl: 'https://kalababyspa.online/reservasionline?fbclid=test_fbclid_123',
      fbclid: 'test_fbclid_123',
      fbp: 'fb.1.123.456',
      fbc: 'fb.1.123.test_fbclid_123',
      utm_source: 'instagram',
      utm_campaign: 'promo-oktober',
      tenantId: 'default-tenant',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/tracking/pageview',
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
      },
      payload: JSON.stringify(payloadObj),
    });

    expect(res.statusCode).toBe(200);
    expect(capturedData).toBeDefined();
    expect(capturedData.eventId).toBe('pv_beacon_text_plain_1');
    expect(capturedData.fbclid).toBe('test_fbclid_123');
    expect(capturedData.fbp).toBe('fb.1.123.456');
    expect(capturedData.utmSource).toBe('instagram');
    expect(capturedData.utmCampaign).toBe('promo-oktober');
    expect(capturedData.source).toBe('beacon');
  });

  it('2. OPTIONS /api/tracking/click menyediakan preflight CORS lengkap untuk panggilan lintas-origin', async () => {
    app = buildApp();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/tracking/click',
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toBeDefined();
  });
});
