import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { matchAdClickAndFireContact } from '../../src/services/ad-attribution.service';
import { capiService, isPublicIp } from '../../src/services/capi.service';
import { prisma } from '../../src/db/client';
import axios from 'axios';

vi.mock('axios');

describe('FASE 4: Attribution Integrity & Funnel Collision Prevention', () => {
  const tenantId = 'default-tenant';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. isPublicIp menolak localhost, loopback, dan IP privat RFC 1918', () => {
    expect(isPublicIp('127.0.0.1')).toBe(false);
    expect(isPublicIp('::1')).toBe(false);
    expect(isPublicIp('localhost')).toBe(false);
    expect(isPublicIp('192.168.1.10')).toBe(false);
    expect(isPublicIp('10.0.0.5')).toBe(false);
    expect(isPublicIp('172.16.0.1')).toBe(false);
    expect(isPublicIp('100.64.0.1')).toBe(false);

    // IP Publik valid
    expect(isPublicIp('114.124.205.12')).toBe(true);
    expect(isPublicIp('180.244.10.5')).toBe(true);
    expect(isPublicIp('8.8.8.8')).toBe(true);
  });

  it('2. Repeat customer yang klik Web CTA baru tidak menabrak P2002 @unique customerId', async () => {
    const existingAdClick = {
      id: 'existing-ad-click-1',
      customerId: 'cust-repeat-1',
      trackingCode: 'PROMO-LAMA',
      utmCampaign: 'PROMO-LAMA',
      utmSource: 'whatsapp_direct',
    };

    const incomingWebClick = {
      id: 'incoming-ad-click-2',
      trackingCode: 'PROMO-BARU-2026',
      customerId: null,
      utmCampaign: 'promo_lebaran_2026',
      utmSource: 'ig',
      utmMedium: 'paid',
      fbclid: 'NEW_FBCLID_999',
      ipAddress: '180.244.10.5',
      userAgent: 'Mozilla/5.0...',
      matchedAt: null,
      createdAt: new Date(),
    };

    // Mock DB: customer sudah punya AdClick lama
    vi.mocked(prisma.adClick.findUnique).mockResolvedValue(existingAdClick as any);
    vi.mocked(prisma.adClick.findFirst).mockResolvedValue(incomingWebClick as any);
    const updateSpy = vi.mocked(prisma.adClick.update).mockResolvedValue({
      ...existingAdClick,
      trackingCode: 'PROMO-BARU-2026',
      utmCampaign: 'promo_lebaran_2026',
      fbclid: 'NEW_FBCLID_999',
    } as any);
    const deleteSpy = vi.mocked(prisma.adClick.delete).mockResolvedValue(incomingWebClick as any);

    const sendSpy = vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({ success: true } as any);

    const result = await matchAdClickAndFireContact({
      bodyText: 'Promo[PROMO-BARU-2026] Halo Kak mau tanya promo baru',
      isNewCustomerRecord: false,
      customer: { id: 'cust-repeat-1', phone: '08123456789', name: 'Bunda Rina' },
      tenantId,
    });

    expect(result.matched).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: 'existing-ad-click-1' },
      data: expect.objectContaining({
        trackingCode: 'PROMO-BARU-2026',
        utmCampaign: 'promo_lebaran_2026',
        fbclid: 'NEW_FBCLID_999',
      }),
    });
    expect(deleteSpy).toHaveBeenCalledWith({ where: { id: 'incoming-ad-click-2' } });
    expect(sendSpy).toHaveBeenCalled();
  });

  it('3. Pencegahan tabrakan event_id: Contact, Lead, dan InitiateCheckout memiliki postfix eventName', async () => {
    let capturedPayload: any = null;
    vi.mocked(axios.post).mockImplementation(async (_url: any, payload: any) => {
      capturedPayload = payload;
      return { status: 200, data: { events_received: 1 } };
    });

    // Test Contact
    await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer: { id: 'cust-collision-test', phone: '08123456789' },
      adClick: { trackingCode: 'CAMPAIGN_CODE_123' },
      tenantId,
    });
    expect(capturedPayload.data[0].event_id).toBe('CAMPAIGN_CODE_123_contact');

    // Test Lead
    await capiService.sendCapiEvent({
      eventName: 'Lead',
      customer: { id: 'cust-collision-test', phone: '08123456789' },
      adClick: { trackingCode: 'CAMPAIGN_CODE_123' },
      tenantId,
    });
    expect(capturedPayload.data[0].event_id).toBe('CAMPAIGN_CODE_123_lead');
  });

  it('4. Guard A-017: customer dengan ID sintetis (pv_*, temp_*) tidak mengirimkan external_id', async () => {
    let capturedPayload: any = null;
    vi.mocked(axios.post).mockImplementation(async (_url: any, payload: any) => {
      capturedPayload = payload;
      return { status: 200, data: { events_received: 1 } };
    });

    await capiService.sendCapiEvent({
      eventName: 'PageView',
      customer: { id: 'pv_1731900000_anon', phone: '08123456789' },
      tenantId,
    });

    expect(capturedPayload.data[0].user_data.external_id).toBeUndefined();
  });

  it('5. Guard A-005: Modal JSON customUserData dengan "sha256(value)" dinormalisasi dan di-hash riil', async () => {
    let capturedPayload: any = null;
    vi.mocked(axios.post).mockImplementation(async (_url: any, payload: any) => {
      capturedPayload = payload;
      return { status: 200, data: { events_received: 1 } };
    });

    await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer: { id: 'cust-test-sha', phone: '08123456789' },
      tenantId,
      customUserData: {
        ph: 'sha256(081234567890)',
        st: 'sha256(jawa timur)',
      },
    });

    const userData = capturedPayload.data[0].user_data;
    // Nilai ph dan st bukan literal 'sha256(...)', melainkan array hash hex 64-karakter
    expect(userData.ph).toBeDefined();
    expect(userData.ph[0]).toMatch(/^[a-f0-9]{64}(\.[a-zA-Z0-9_-]+)?$/);
    expect(userData.ph[0]).not.toContain('sha256(');

    expect(userData.st).toBeDefined();
    expect(userData.st[0]).toMatch(/^[a-f0-9]{64}(\.[a-zA-Z0-9_-]+)?$/);
    expect(userData.st[0]).not.toContain('sha256(');
  });
});
