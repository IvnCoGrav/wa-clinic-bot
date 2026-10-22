import { describe, it, expect, beforeEach, vi } from 'vitest';
import { capiService, capiBreaker } from '../../src/services/capi.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { prisma } from '../../src/db/client';

/**
 * Tahap B (A-001): action_source WAJIB akurat per jenis event
 * (Meta docs — Server Event Parameters):
 * - "chat — Conversion was made via a messaging app, SMS, or online messaging feature."
 * - "Website events shared using the Conversions API require the client_user_agent,
 *    action_source, and event_source_url parameters" → PageView dari landing web
 *    memakai action_source 'website', bukan 'chat'.
 * Dokumentasi Meta tidak mengizinkan pelabelan salah; admin menyatakan accuracy commitment.
 */
describe('Kesesuaian action_source per event (Tahap B3)', () => {
  let sentPayload: any = null;
  let breakerSpy: any;

  beforeEach(() => {
    sentPayload = null;
    breakerSpy = vi.spyOn(capiBreaker, 'execute').mockImplementation(async (_url: any, payload: any) => {
      sentPayload = payload;
      return { status: 200, data: { events_received: 1 } };
    });
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      settings: {},
    } as any);
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.count).mockResolvedValue(0);
  });

  it('1. PageView (event web) memakai action_source website + client_user_agent + event_source_url + event_id pixel', async () => {
    await capiService.sendCapiEvent({
      eventName: 'PageView',
      customer: { phone: '', id: 'pv_1' },
      adClick: {
        trackingCode: 'fb-pageview-ev-1',
        landingUrl: 'https://tenant.example/promo-slug',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36',
        fbp: 'fb.1.1790000000.100200300',
        fbc: 'fb.1.1790000000.abc',
        ipAddress: '8.8.8.8',
      },
      tenantId: DEFAULT_TENANT_ID,
    });

    const event = sentPayload.data[0];
    expect(event.action_source).toBe('website');
    expect(event.event_id).toBe('fb-pageview-ev-1');
    expect(event.event_source_url).toBe('https://tenant.example/promo-slug');
    expect(event.user_data.client_user_agent).toBe('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36');
  });

  it('2. Purchase & Contact dari percakapan memakai action_source chat', async () => {
    const base = {
      eventName: 'Purchase',
      customer: { id: 'cust-src', phone: '081234567890' },
      tenantId: DEFAULT_TENANT_ID,
      eventTime: 1790000000,
      value: 90000,
    };
    await capiService.sendCapiEvent({ ...base, reservationId: 'res-src-1' } as any);
    expect(sentPayload.data[0].action_source).toBe('chat');

    await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer: { id: 'cust-src', phone: '081234567890' },
      tenantId: DEFAULT_TENANT_ID,
      eventTime: 1790000000,
    } as any);
    expect(sentPayload.data[0].action_source).toBe('chat');
  });

  it('3. PageView tanpa landingUrl tapi tenant punya domain → pakai domain tenant sebagai event_source_url', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      landing_domain: 'https://tenant.example',
      settings: {},
    } as any);

    await capiService.sendCapiEvent({
      eventName: 'PageView',
      customer: { phone: '', id: 'pv_2' },
      adClick: { trackingCode: 'fb-pageview-ev-2', userAgent: 'UA-Test' },
      tenantId: DEFAULT_TENANT_ID,
    } as any);

    const event = sentPayload.data[0];
    expect(event.action_source).toBe('website');
    expect(event.event_source_url).toBe('https://tenant.example/');
  });
});
