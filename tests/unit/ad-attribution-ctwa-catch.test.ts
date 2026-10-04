import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchAdClickAndFireContact } from '../../src/services/ad-attribution.service';
import { prisma } from '../../src/db/client';
import { capiService } from '../../src/services/capi.service';
import { __setMemoryCatchers, __clearMemoryCatchers } from '../../src/services/ctwa-text-catcher.service';

const TENANT = 'default-tenant';

function seedCatcher(over: Partial<any> = {}) {
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
      ...over,
    },
  ]);
}

describe('ad-attribution — CTWA Greeting Catcher (Priority 3)', () => {
  beforeEach(() => {
    vi.stubEnv('FB_PIXEL_ID', 'mock_pixel_123');
    vi.stubEnv('FB_CAPI_ACCESS_TOKEN', 'mock_token_123');
    vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({ success: true } as any);
    __clearMemoryCatchers();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    __clearMemoryCatchers();
  });

  it('Priority 1 menang: native ctwa_clid + teks fuzzy → tercatat sebagai CTWA native, bukan fuzzy', async () => {
    seedCatcher();
    const createSpy = vi.spyOn(prisma.adClick, 'create').mockResolvedValue({ id: 'c', ctwa_clid: 'CLID1' } as any);

    const res = await matchAdClickAndFireContact({
      bodyText: 'halo min mau tny prmo baby spa sby',
      isNewCustomerRecord: true,
      customer: { id: 'cust1', phone: '628111111111' },
      tenantId: TENANT,
      referral: { ctwaClid: 'CLID1', sourceApp: 'instagram', sourceId: 'camp-123' },
    });

    expect(res.matched).toBe(true);
    expect(res.ctwaClid).toBe('CLID1');
    expect(createSpy).toHaveBeenCalledTimes(1);
    const arg = createSpy.mock.calls[0][0] as any;
    expect(arg.data.ctwa_clid).toBe('CLID1');
    expect(arg.data.utmMedium).toBe('ctwa');
    expect(arg.data.utmMedium).not.toBe('ctwa_fuzzy');
  });

  it('Priority 2 menang: Promo[xx] + teks fuzzy → atribusi web CTA, bukan fuzzy', async () => {
    seedCatcher();
    vi.spyOn(prisma.adClick, 'updateMany').mockResolvedValue({ count: 0 } as any);
    vi.spyOn(prisma.adClick, 'findUnique').mockResolvedValue(null as any);
    const createSpy = vi
      .spyOn(prisma.adClick, 'create')
      .mockResolvedValue({ id: 'c2', utmSource: 'whatsapp_direct' } as any);

    const res = await matchAdClickAndFireContact({
      bodyText: 'Promo[IG-BABYSPA] halo min mau tny prmo baby spa sby',
      isNewCustomerRecord: true,
      customer: { id: 'cust2', phone: '628222222222' },
      tenantId: TENANT,
    });

    expect(res.matched).toBe(true);
    expect(res.trackingCode).toBe('IG-BABYSPA');
    const fuzzyCalls = createSpy.mock.calls.filter((c) => (c[0] as any)?.data?.utmMedium === 'ctwa_fuzzy');
    expect(fuzzyCalls.length).toBe(0);
  });

  it('first-touch fuzzy: customer baru + teks iklan → AdClick ctwa_fuzzy dibuat', async () => {
    seedCatcher();
    const createSpy = vi
      .spyOn(prisma.adClick, 'create')
      .mockResolvedValue({ id: 'c3', utmMedium: 'ctwa_fuzzy' } as any);

    const res = await matchAdClickAndFireContact({
      bodyText: 'halo min mau tny prmo baby spa sby',
      isNewCustomerRecord: true,
      customer: { id: 'cust3', phone: '628333333333' },
      tenantId: TENANT,
    });

    expect(res.matched).toBe(true);
    const arg = createSpy.mock.calls[0][0] as any;
    expect(arg.data.utmMedium).toBe('ctwa_fuzzy');
    expect(arg.data.utmCampaign).toBe('IG-BABYSPA');
    expect(arg.data.utmSource).toBe('instagram');
    expect(String(arg.data.trackingCode).startsWith('ctwa_fuzzy_')).toBe(true);
  });

  it('mid-conversation immunity: percakapan aktif (<24j) + sudah ber-atribusi → TIDAK match fuzzy', async () => {
    seedCatcher();
    vi.spyOn(prisma.adClick, 'findUnique').mockResolvedValue({ id: 'existing', customerId: 'cust4', ctwa_clid: 'OLD', utmCampaign: 'OLD' } as any);
    const createSpy = vi.spyOn(prisma.adClick, 'create');

    const res = await matchAdClickAndFireContact({
      bodyText: 'halo min mau tny prmo baby spa sby',
      isNewCustomerRecord: false,
      customer: { id: 'cust4', phone: '628444444444' },
      tenantId: TENANT,
      lastCustomerMessageAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    expect(res.matched).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('idle >24 jam: percakapan lama tetap boleh match fuzzy', async () => {
    seedCatcher();
    vi.spyOn(prisma.adClick, 'findUnique').mockResolvedValue({ id: 'existing', customerId: 'cust5', ctwa_clid: 'OLD', utmCampaign: 'OLD' } as any);
    const createSpy = vi
      .spyOn(prisma.adClick, 'create')
      .mockResolvedValue({ id: 'c5', utmMedium: 'ctwa_fuzzy' } as any);

    const res = await matchAdClickAndFireContact({
      bodyText: 'halo min mau tny prmo baby spa sby',
      isNewCustomerRecord: false,
      customer: { id: 'cust5', phone: '628555555555' },
      tenantId: TENANT,
      lastCustomerMessageAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });

    expect(res.matched).toBe(true);
    const arg = createSpy.mock.calls[0][0] as any;
    expect(arg.data.utmMedium).toBe('ctwa_fuzzy');
  });

  it('organik tanpa anchor → tidak match (teks tidak bermutilasi)', async () => {
    seedCatcher();
    const createSpy = vi.spyOn(prisma.adClick, 'create');

    const res = await matchAdClickAndFireContact({
      bodyText: 'Halo admin, mau tanya jadwal klinik buka jam berapa?',
      isNewCustomerRecord: false,
      customer: { id: 'cust6', phone: '628666666666' },
      tenantId: TENANT,
    });

    expect(res.matched).toBe(false);
    expect(res.strippedText).toBe('Halo admin, mau tanya jadwal klinik buka jam berapa?');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('DB offline: catcher tidak melempar ke webhook (fail-open)', async () => {
    // Tanpa seed + DB offline → matchInboundText mengembalikan [] → tidak match, tidak throw.
    const res = await matchAdClickAndFireContact({
      bodyText: 'halo min mau tny prmo baby spa sby',
      isNewCustomerRecord: true,
      customer: { id: 'cust7', phone: '628777777777' },
      tenantId: TENANT,
    });
    expect(res.matched).toBe(false);
  });
});
