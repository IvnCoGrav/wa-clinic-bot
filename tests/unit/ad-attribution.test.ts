import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchAdClickAndFireContact } from '../../src/services/ad-attribution.service';
import { prisma } from '../../src/db/client';
import { capiService } from '../../src/services/capi.service';

describe('ad-attribution.service Unit Tests', () => {
  beforeEach(() => {
    vi.stubEnv('FB_PIXEL_ID', 'mock_pixel_123');
    vi.stubEnv('FB_CAPI_ACCESS_TOKEN', 'mock_token_123');
    vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('should match text promo code for new customer, update DB, and fire CAPI Contact', async () => {
    vi.spyOn(prisma.adClick, 'updateMany').mockResolvedValue({ count: 1 } as any);
    vi.spyOn(prisma.adClick, 'findFirst').mockResolvedValue({
      id: 'click_1',
      trackingCode: 'a7',
      customerId: 'cust_1',
    } as any);

    const result = await matchAdClickAndFireContact({
      bodyText: 'Promo[a7] halo min',
      isNewCustomerRecord: true,
      customer: { id: 'cust_1', phone: '628123456789' },
      tenantId: 'default-tenant',
    });

    expect(result.matched).toBe(true);
    expect(result.trackingCode).toBe('a7');
    expect(result.strippedText).toBe('halo min');
    expect(prisma.adClick.updateMany).toHaveBeenCalledWith({
      where: { trackingCode: 'a7', tenant_id: 'default-tenant', matchedAt: null },
      data: { matchedAt: expect.any(Date), customerId: 'cust_1' },
    });
    expect(capiService.sendCapiEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'Contact',
        tenantId: 'default-tenant',
        customData: expect.objectContaining({
          trackingCode: 'a7',
          source: 'WHATSAPP_INBOUND_CTA',
        }),
      })
    );
  });

  it('should match promo code and fire CAPI Contact for existing customer clicking ad', async () => {
    vi.spyOn(prisma.adClick, 'updateMany').mockResolvedValue({ count: 1 } as any);
    vi.spyOn(prisma.adClick, 'findFirst').mockResolvedValue({
      id: 'click_2',
      trackingCode: 'a7',
      customerId: 'cust_existing',
    } as any);

    const result = await matchAdClickAndFireContact({
      bodyText: 'Promo[a7] halo min',
      isNewCustomerRecord: false,
      customer: { id: 'cust_existing', phone: '628123456790' },
      tenantId: 'default-tenant',
    });

    expect(result.matched).toBe(true);
    expect(result.trackingCode).toBe('a7');
    expect(result.strippedText).toBe('halo min');
    expect(prisma.adClick.updateMany).toHaveBeenCalledWith({
      where: { trackingCode: 'a7', tenant_id: 'default-tenant', matchedAt: null },
      data: { matchedAt: expect.any(Date), customerId: 'cust_existing' },
    });
    expect(capiService.sendCapiEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'Contact',
        tenantId: 'default-tenant',
        customData: expect.objectContaining({
          trackingCode: 'a7',
          source: 'WHATSAPP_INBOUND_CTA',
        }),
      })
    );
  });

  it('should NOT fire organic CAPI Contact for existing customer WITHOUT promo code', async () => {
    const result = await matchAdClickAndFireContact({
      bodyText: 'Halo min, mau tanya lagi',
      isNewCustomerRecord: false,
      customer: { id: 'cust_existing', phone: '628123456792' },
      tenantId: 'default-tenant',
    });

    expect(result.matched).toBe(false);
    expect(result.strippedText).toBe('Halo min, mau tanya lagi');
    expect(capiService.sendCapiEvent).not.toHaveBeenCalled();
  });

  it('should fire organic CAPI Contact for new customer WITHOUT promo code', async () => {
    const result = await matchAdClickAndFireContact({
      bodyText: 'Halo min, mau tanya price list',
      isNewCustomerRecord: true,
      customer: { id: 'cust_organic', phone: '628123456791' },
      tenantId: 'default-tenant',
    });

    expect(result.matched).toBe(false);
    expect(result.strippedText).toBe('Halo min, mau tanya price list');
    expect(capiService.sendCapiEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'Contact',
        tenantId: 'default-tenant',
        customData: expect.objectContaining({
          source: 'WHATSAPP_INBOUND_ORGANIC',
        }),
      })
    );
  });

  it('should enrich CTWA ad-click with ad identity (sourceId/sourceApp) when present', async () => {
    vi.spyOn(prisma.adClick, 'create').mockResolvedValue({
      id: 'click_ctwa_2',
      ctwa_clid: 'CTWA_CLID_ENRICH',
      customerId: 'cust_ctwa_2',
    } as any);

    const result = await matchAdClickAndFireContact({
      bodyText: 'Halo',
      isNewCustomerRecord: true,
      customer: { id: 'cust_ctwa_2', phone: '628123456794' },
      tenantId: 'default-tenant',
      referral: {
        ctwaClid: 'CTWA_CLID_ENRICH',
        sourceId: '120250673996340235',
        sourceApp: 'instagram',
        sourceUrl: 'https://www.instagram.com/p/Dd0LihqAEmX/',
        headline: 'PROMO KHUSUS SURABAYA & SIDOARJO!',
      },
    });

    expect(result.matched).toBe(true);
    expect(prisma.adClick.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        utmSource: 'instagram',
        utmMedium: 'ctwa',
        utmCampaign: '120250673996340235',
        landingUrl: 'https://www.instagram.com/p/Dd0LihqAEmX/',
      }),
    });
  });

  it('should match native CTWA ctwa_clid referral from Meta for new customer', async () => {
    vi.spyOn(prisma.adClick, 'create').mockResolvedValue({
      id: 'click_ctwa_1',
      ctwa_clid: 'CTWA_CLID_999',
      customerId: 'cust_ctwa',
    } as any);

    const result = await matchAdClickAndFireContact({
      bodyText: 'Halo',
      isNewCustomerRecord: true,
      customer: { id: 'cust_ctwa', phone: '628123456793' },
      tenantId: 'default-tenant',
      referral: {
        ctwaClid: 'CTWA_CLID_999',
        sourceUrl: 'https://fb.me/ad123',
        sourceType: 'ad',
        headline: 'Pijat Ibu Hamil',
      },
    });

    expect(result.matched).toBe(true);
    expect(result.ctwaClid).toBe('CTWA_CLID_999');
    expect(prisma.adClick.create).toHaveBeenCalledWith({
      data: {
        ctwa_clid: 'CTWA_CLID_999',
        landingUrl: 'https://fb.me/ad123',
        utmSource: 'meta',
        utmMedium: 'ctwa',
        utmCampaign: 'ctwa_direct',
        matchedAt: expect.any(Date),
        customerId: 'cust_ctwa',
        tenant_id: 'default-tenant',
        phone: '628123456793',
      },
    });
  });
});
