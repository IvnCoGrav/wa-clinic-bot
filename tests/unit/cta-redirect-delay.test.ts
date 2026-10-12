import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { TenantHtmlService } from '../../src/services/tenant-html.service';

describe('CTA & Landing Redirect Delay — Anti-Race Pixel Flush (Fase 1)', () => {
  const app = buildApp();

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

  it('1. GET /cta menghasilkan redirect delay 300ms untuk memberi jeda Meta Pixel flush', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cta?slug=default',
    });

    expect(res.statusCode).toBe(200);
    const html = res.payload;
    expect(html).toContain('setTimeout(function() {');
    expect(html).toContain('window.location.href =');
    expect(html).toMatch(/setTimeout\(\s*function\(\)\s*\{[^}]*window\.location\.href\s*=\s*[^;]+;\s*\},?\s*300\s*\);/);
  });

  it('2. GET /go template menghasilkan delay 300ms dan guard isRedirecting', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/go?slug=default',
    });

    expect(res.statusCode).toBe(200);
    const html = res.payload;
    expect(html).toContain('isRedirecting');
    expect(html).toContain('clearTimeout(safetyTimeout)');
    expect(html).toMatch(/setTimeout\(\s*function\(\)\s*\{[^}]*window\.location\.href\s*=\s*redirectUrl;?\s*\},?\s*300\s*\);/);
  });

  it('3. TenantHtmlService.injectTracking menghasilkan delay 300ms dan guard isRedirecting', () => {
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
      ['Contact']
    );

    expect(injected).toContain('isRedirecting');
    expect(injected).toContain('clearTimeout(safetyTimeout)');
    expect(injected).toMatch(/setTimeout\(\s*function\(\)\s*\{[^}]*window\.location\.href\s*=\s*redirectUrl;?\s*\},?\s*300\s*\);/);
  });

  it('4. Adversarial: go.html dan injectTracking memiliki guard window.fbq aman dari throw jika diblok adblocker', () => {
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
      ['Contact']
    );

    // Pastikan pemanggilan Pixel dibungkus pengecekan window.fbq agar adblocker tidak melempar ReferenceError
    expect(injected).toContain('if (window.fbq)');

    // Pastikan fallback redirect tetap ada jika fetch API error
    expect(injected).toContain('executeFallbackRedirect');
    expect(injected).toContain('if (isRedirecting) return;');
  });
});
