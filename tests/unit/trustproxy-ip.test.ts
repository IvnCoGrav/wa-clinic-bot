import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

describe('TrustProxy & Per-IP Rate Limit Isolation (Fase 2)', () => {
  let app: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    (prisma as any).tenant = {
      findUnique: vi.fn().mockResolvedValue({
        id: 'default-tenant',
        slug: 'default',
        meta_pixel_id: '1234567890',
        whatsapp_number: '628123456789',
      }),
      findMany: vi.fn().mockResolvedValue([]),
    };
    (prisma as any).landingPage = {
      findFirst: vi.fn().mockResolvedValue(null),
    };
  });

  it('1. POST /api/tracking/pageview menghormati X-Forwarded-For dan mencatat IP asli client saat trustProxy aktif', async () => {
    let capturedIp: string | null = null;
    (prisma as any).landingPageView = {
      create: vi.fn().mockImplementation((args: any) => {
        capturedIp = args?.data?.ipAddress || null;
        return Promise.resolve({ id: 'lpv_123' });
      }),
    };

    app = buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/tracking/pageview',
      headers: {
        'x-forwarded-for': '180.252.1.2',
        'content-type': 'application/json',
      },
      payload: {
        eventID: 'pv_test_trustproxy',
        landingUrl: 'https://kalababyspa.online/reservasionline',
        tenantId: 'default-tenant',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(capturedIp).toBe('180.252.1.2');
  });

  it('2. Rate limit /cta terisolasi per IP client via trustProxy', async () => {
    app = buildApp();

    // IP A melakukan 60 request
    for (let i = 0; i < 60; i++) {
      const resA = await app.inject({
        method: 'GET',
        url: '/cta?slug=default',
        headers: {
          'x-forwarded-for': '114.79.18.1',
        },
      });
      expect(resA.statusCode).toBe(200);
    }

    // Request ke-61 untuk IP A harus 429
    const resA61 = await app.inject({
      method: 'GET',
      url: '/cta?slug=default',
      headers: {
        'x-forwarded-for': '114.79.18.1',
      },
    });
    expect(resA61.statusCode).toBe(429);
    expect(resA61.headers['retry-after']).toBeDefined();

    // IP B harus TETAP 200 (tidak kena limit milik IP A)
    const resB = await app.inject({
      method: 'GET',
      url: '/cta?slug=default',
      headers: {
        'x-forwarded-for': '114.79.18.2',
      },
    });
    expect(resB.statusCode).toBe(200);
  });
});
