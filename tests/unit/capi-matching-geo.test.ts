import { describe, it, expect, beforeEach, vi } from 'vitest';
import { capiService, capiBreaker, getTenantCapiMatchingGeo } from '../../src/services/capi.service';
import { ParamBuilder, PII_DATA_TYPE } from 'capi-param-builder-nodejs';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { prisma } from '../../src/db/client';

/**
 * Tahap B (A-010): lokasi fisik (state/country) dan domain fallback landing
 * WAJIB konfigurasi tenant (`Tenant.settings`), bukan hardcode di kode.
 */
describe('Matching geo & fallback domain tenant-aware (Tahap B4)', () => {
  let breakerSpy: any;

  beforeEach(() => {
    breakerSpy = vi.spyOn(capiBreaker, 'execute').mockImplementation(async () => ({ status: 200, data: { events_received: 1 } }));
  });

  it('1. default fail-safe saat tenant/DB offline', async () => {
    vi.mocked(prisma.tenant.findUnique).mockRejectedValue(new Error('Database offline'));
    expect(await getTenantCapiMatchingGeo(DEFAULT_TENANT_ID)).toEqual({ state: 'jawa timur', country: 'id' });
    expect(await getTenantCapiMatchingGeo(undefined)).toEqual({ state: 'jawa timur', country: 'id' });
  });

  it('2. settings.capiMatchingGeo mengoverride default per tenant', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: 'tenant-bali',
      settings: { capiMatchingGeo: { state: 'bali', country: 'id' } },
    } as any);
    expect(await getTenantCapiMatchingGeo('tenant-bali')).toEqual({ state: 'bali', country: 'id' });
  });

  it('3. userData gunakan nilai konfigurasi tenant untuk st/country (bukan hardcode)', async () => {
    const builder = new ParamBuilder();
    const expectedState = builder.getNormalizedAndHashedPII('jawa tengah', PII_DATA_TYPE.STATE);
    const expectedCountry = builder.getNormalizedAndHashedPII('id', PII_DATA_TYPE.COUNTRY);

    let sentPayload: any = null;
    breakerSpy.mockImplementation(async (_u: any, payload: any) => {
      sentPayload = payload;
      return { status: 200, data: { events_received: 1 } };
    });

    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      settings: { capiMatchingGeo: { state: 'jawa tengah', country: 'id' } },
    } as any);
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.reservation.count).mockResolvedValue(0);

    await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-geo', phone: '081234567890' },
      tenantId: DEFAULT_TENANT_ID,
      reservationId: 'res-geo-1',
      eventTime: 1790000000,
      value: 100000,
    });

    expect(sentPayload.data[0].user_data.st).toEqual([expectedState]);
    expect(sentPayload.data[0].user_data.country).toEqual([expectedCountry]);
  });
});
