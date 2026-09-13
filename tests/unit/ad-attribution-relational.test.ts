import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchAdClickAndFireContact } from '../../src/services/ad-attribution.service';
import { prisma } from '../../src/db/client';
import { capiService } from '../../src/services/capi.service';

describe('Ad Attribution Relational Idempotency (Matt Pocock Standard)', () => {
  beforeEach(() => {
    vi.stubEnv('FB_PIXEL_ID', 'mock_pixel_123');
    vi.stubEnv('FB_CAPI_ACCESS_TOKEN', 'mock_token_123');
    vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('Scenario 1: Dua customer berbeda mengirim kode kampanye direct CTWA yang sama tanpa collision trackingCode', async () => {
    vi.spyOn(prisma.adClick, 'updateMany').mockResolvedValue({ count: 0 } as any);
    vi.spyOn(prisma.adClick, 'findUnique').mockResolvedValue(null); // Keduanya belum punya AdClick
    const createSpy = vi.spyOn(prisma.adClick, 'create').mockImplementation(async (args: any) => ({
      id: `click_${Math.random()}`,
      ...args.data,
    } as any));

    // Customer 1
    const res1 = await matchAdClickAndFireContact({
      bodyText: 'Halo Bidan Yusi, saya tertarik Promo [IG-BABYSPA]',
      isNewCustomerRecord: true,
      customer: { id: 'cust_1', phone: '628111111111' },
      tenantId: 'default-tenant',
    });

    // Customer 2 (mengirim template iklan yang persis sama)
    const res2 = await matchAdClickAndFireContact({
      bodyText: 'Halo Bidan Yusi, saya tertarik Promo [IG-BABYSPA]',
      isNewCustomerRecord: true,
      customer: { id: 'cust_2', phone: '628222222222' },
      tenantId: 'default-tenant',
    });

    expect(res1.matched).toBe(true);
    expect(res2.matched).toBe(true);
    expect(createSpy).toHaveBeenCalledTimes(2);

    const call1Data = createSpy.mock.calls[0][0].data;
    const call2Data = createSpy.mock.calls[1][0].data;

    // Kampanye sama
    expect(call1Data.utmCampaign).toBe('IG-BABYSPA');
    expect(call2Data.utmCampaign).toBe('IG-BABYSPA');

    // Namun trackingCode di database dijamin UNIK (tidak menabrak @unique trackingCode)
    expect(call1Data.trackingCode).toMatch(/^ctwa_[a-f0-9]{16}$/);
    expect(call2Data.trackingCode).toMatch(/^ctwa_[a-f0-9]{16}$/);
    expect(call1Data.trackingCode).not.toBe(call2Data.trackingCode);

    // CustomerId masing-masing
    expect(call1Data.customerId).toBe('cust_1');
    expect(call2Data.customerId).toBe('cust_2');
  });

  it('Scenario 2: Customer lama yang sudah memiliki AdClick mengklik kampanye baru (idempotent update)', async () => {
    vi.spyOn(prisma.adClick, 'updateMany').mockResolvedValue({ count: 0 } as any);
    const existingClick = {
      id: 'existing_adclick_id_123',
      trackingCode: 'ctwa_old123456789012',
      utmCampaign: 'IG-OLD-PROMO',
      customerId: 'cust_returning',
      phone: '628333333333',
    };
    vi.spyOn(prisma.adClick, 'findUnique').mockResolvedValue(existingClick as any);
    const updateSpy = vi.spyOn(prisma.adClick, 'update').mockResolvedValue({
      ...existingClick,
      utmCampaign: 'IG-NEW-PROMO',
    } as any);
    const createSpy = vi.spyOn(prisma.adClick, 'create');

    const res = await matchAdClickAndFireContact({
      bodyText: 'Halo Bidan Yusi, promo [IG-NEW-PROMO] masih ada?',
      isNewCustomerRecord: false,
      customer: { id: 'cust_returning', phone: '628333333333' },
      tenantId: 'default-tenant',
    });

    expect(res.matched).toBe(true);
    // DILARANG memanggil create (yang akan crash melanggar @unique customerId)
    expect(createSpy).not.toHaveBeenCalled();
    // WAJIB memanggil update pada record yang sudah ada
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: 'existing_adclick_id_123' },
      data: expect.objectContaining({
        utmCampaign: 'IG-NEW-PROMO',
        utmSource: 'whatsapp_direct',
        phone: '628333333333',
      }),
    });
  });

  it('Scenario 3: Native CTWA referral Meta (WABA) untuk customer yang sudah ada mengupdate record secara aman', async () => {
    const existingClick = {
      id: 'existing_ctwa_123',
      ctwa_clid: 'old_clid_1',
      customerId: 'cust_existing_waba',
      phone: '628444444444',
    };
    vi.spyOn(prisma.adClick, 'findUnique').mockResolvedValue(existingClick as any);
    const updateSpy = vi.spyOn(prisma.adClick, 'update').mockResolvedValue({
      ...existingClick,
      ctwa_clid: 'new_clid_999',
    } as any);
    const createSpy = vi.spyOn(prisma.adClick, 'create');

    const res = await matchAdClickAndFireContact({
      bodyText: 'Halo',
      isNewCustomerRecord: false,
      customer: { id: 'cust_existing_waba', phone: '628444444444' },
      tenantId: 'default-tenant',
      referral: {
        ctwaClid: 'new_clid_999',
        sourceUrl: 'https://fb.me/ad123',
      },
    });

    expect(res.matched).toBe(true);
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: 'existing_ctwa_123' },
      data: expect.objectContaining({
        ctwa_clid: 'new_clid_999',
        landingUrl: 'https://fb.me/ad123',
        phone: '628444444444',
      }),
    });
  });
});
