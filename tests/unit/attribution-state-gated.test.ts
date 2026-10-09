import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchAdClickAndFireContact } from '../../src/services/ad-attribution.service';
import { prisma } from '../../src/db/client';
import { capiService } from '../../src/services/capi.service';
import { __setMemoryCatchers, __clearMemoryCatchers } from '../../src/services/ctwa-text-catcher.service';

const TENANT = 'default-tenant';

function seedCatcher() {
  __setMemoryCatchers(TENANT, [
    {
      id: 'catcher-1',
      tenant_id: TENANT,
      campaign_name: 'IG-BABYSPA',
      source: 'instagram',
      medium: 'ctwa',
      greetings: ['Halo Bidan, saya mau tanya promo Baby Spa Surabaya'],
      anchor_keywords: ['baby spa'],
      similarity_threshold: 0.7,
      is_active: true,
      notes: null,
    },
  ]);
}

describe('Fase 3.2: State-Gated Fuzzy CTWA Greeting Catcher', () => {
  beforeEach(() => {
    vi.stubEnv('FB_PIXEL_ID', 'mock_pixel_123');
    vi.stubEnv('FB_CAPI_ACCESS_TOKEN', 'mock_token_123');
    vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({ success: true } as any);
    __clearMemoryCatchers();
    seedCatcher();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    __clearMemoryCatchers();
  });

  it('should BLOCK fuzzy greeting catcher if customer is a repeat customer (has confirmed/completed reservation)', async () => {
    // Customer has 1 confirmed reservation in DB
    vi.mocked(prisma.reservation.count).mockResolvedValueOnce(1);
    vi.mocked(prisma.adClick.findUnique).mockResolvedValueOnce(null as any);

    const res = await matchAdClickAndFireContact({
      bodyText: 'Halo Bidan, saya mau tanya promo Baby Spa Surabaya',
      isNewCustomerRecord: false,
      customer: { id: 'cust-repeat-1', phone: '628111111111' },
      tenantId: TENANT,
    });

    expect(res.matched).toBe(false);
    expect(res.adClick).toBeNull();
  });

  it('should PRESERVE native CTWA clid and BLOCK fuzzy greeting catcher from overwriting it', async () => {
    // Customer already has native CTWA click
    vi.mocked(prisma.reservation.count).mockResolvedValueOnce(0);
    vi.mocked(prisma.adClick.findUnique).mockResolvedValueOnce({
      id: 'click-native-1',
      ctwa_clid: 'REAL_CTWA_CLID_999',
      utmMedium: 'ctwa',
      utmCampaign: 'ORIGINAL_CAMPAIGN',
    } as any);

    const updateSpy = vi.spyOn(prisma.adClick, 'update');

    const res = await matchAdClickAndFireContact({
      bodyText: 'Halo Bidan, saya mau tanya promo Baby Spa Surabaya',
      isNewCustomerRecord: false,
      customer: { id: 'cust-native-1', phone: '628111111112' },
      tenantId: TENANT,
    });

    // Native attribution preserved, fuzzy matcher blocked, update never called
    expect(res.matched).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('should ALLOW fuzzy greeting catcher for brand new prospect without prior attribution', async () => {
    vi.mocked(prisma.adClick.create).mockResolvedValueOnce({
      id: 'click-fuzzy-1',
      trackingCode: 'ctwa_fuzzy_abc',
      utmCampaign: 'IG-BABYSPA',
      utmMedium: 'ctwa_fuzzy',
    } as any);

    const res = await matchAdClickAndFireContact({
      bodyText: 'Halo Bidan, saya mau tanya promo Baby Spa Surabaya',
      isNewCustomerRecord: true,
      customer: { id: 'cust-new-1', phone: '628111111113' },
      tenantId: TENANT,
    });

    expect(res.matched).toBe(true);
    expect(res.adClick?.utmCampaign).toBe('IG-BABYSPA');
    expect(res.adClick?.utmMedium).toBe('ctwa_fuzzy');
  });
});
