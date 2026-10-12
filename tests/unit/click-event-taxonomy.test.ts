import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { TenantHtmlService } from '../../src/services/tenant-html.service';

describe('Click Event Taxonomy Gate — Purchase Disallowed on Click (Fase 4)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. TenantHtmlService.injectTracking menolak Purchase dari klik tombol dan mempertahankan Contact', () => {
    const sampleHtml = '<html><body><button id="wa-cta">Chat</button></body></html>';
    const injected = TenantHtmlService.injectTracking(
      sampleHtml,
      '1234567890',
      'test-nonce',
      {
        trackingApiBaseUrl: '',
        trackingApiKey: '',
        whatsappNumber: '628123456789',
        tenantId: 'default-tenant',
        tenantSlug: 'default',
      },
      ['Purchase', 'Contact']
    );

    expect(injected).toContain('"Contact"');
    expect(injected).not.toContain('"Purchase"');
    expect(injected).toContain('eventID: trackingCode');
  });

  it('2. TenantHtmlService.injectTracking mengizinkan Lead dan menyertakan eventID: trackingCode', () => {
    const sampleHtml = '<html><body><button id="wa-cta">Chat</button></body></html>';
    const injected = TenantHtmlService.injectTracking(
      sampleHtml,
      '1234567890',
      'test-nonce',
      {
        trackingApiBaseUrl: '',
        trackingApiKey: '',
        whatsappNumber: '628123456789',
        tenantId: 'default-tenant',
        tenantSlug: 'default',
      },
      ['Lead']
    );

    expect(injected).toContain('"Lead"');
    expect(injected).toContain('eventID: trackingCode');
  });

  it('3. GET /go dengan content.events=[Purchase, Contact] menolak Purchase di klik CTA', async () => {
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
      findFirst: vi.fn().mockResolvedValue({
        id: 'lp_1',
        events: ['Purchase', 'Contact'],
      }),
    };

    const res = await app.inject({
      method: 'GET',
      url: '/go?slug=default',
    });

    expect(res.statusCode).toBe(200);
    const html = res.payload;
    expect(html).toContain("fbq('track', 'Contact'");
    expect(html).not.toContain("fbq('track', 'Purchase'");
  });
});
