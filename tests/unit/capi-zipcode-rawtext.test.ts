import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ParamBuilder, PII_DATA_TYPE } from 'capi-param-builder-nodejs';
import { capiService, capiBreaker } from '../../src/services/capi.service';
import { customerService } from '../../src/services/customer.service';
import { prisma } from '../../src/db/client';

const TENANT = 'default-tenant';
const PHONE = '6285738192047';
const RESERVATION_TEXT = [
  'Berikut list untuk reservasi :',
  'Nama Bunda: Zip Test',
  'Alamat & Shareloc : jalan kedungklinter 1 80',
  'Kec : Waru',
  'Kota : Sidoarjo',
  'Treatment : pijat bayi pulih ceria',
].join('\n');

describe('CAPI — fallback zipcode dari raw_text reservasi', () => {
  let sentPayload: any = null;

  beforeEach(() => {
    vi.stubEnv('FB_PIXEL_ID', 'mock_pixel_zip');
    vi.stubEnv('FB_CAPI_ACCESS_TOKEN', 'mock_token_zip');
    sentPayload = null;

    vi.spyOn(capiBreaker, 'execute').mockImplementation(async (_url: string, payload: any) => {
      sentPayload = payload;
      return { status: 200, data: { events_received: 1 } } as any;
    });

    vi.mocked(prisma.customer.findFirst).mockResolvedValue({
      id: 'cust-zip-rawtext',
      tenant_id: TENANT,
      phone: PHONE,
      name: 'Bunda Zip Test',
      zipcode: null,
      pending_zipcode: null,
      kelurahan: null,
      kecamatan: null,
      kota: null,
      preferences: {},
      created_at: new Date(),
    } as any);
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      raw_text: RESERVATION_TEXT,
    } as any);
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.reservation.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.adClick.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.customer.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.spyOn(customerService, 'updateCustomerZipcodeIfEmpty').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('mengisi user_data.zp dari "Kec: Waru" pada raw_text saat kolom wilayah kosong', async () => {
    const result = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-zip-rawtext', phone: PHONE, name: 'Bunda Zip Test' },
      tenantId: TENANT,
      reservationId: 'res-zip-rawtext',
      eventTime: Math.floor(Date.now() / 1000),
      value: 150000,
    });

    expect(result.success).toBe(true);
    expect(result.skipped).not.toBe(true);

    const expectedZipHash = new ParamBuilder().getNormalizedAndHashedPII(
      '61256',
      PII_DATA_TYPE.ZIP_CODE
    );
    expect(sentPayload?.data?.[0]?.user_data?.zp).toEqual([expectedZipHash]);

    // Persistensi non-destruktif lewat seam kanonis (async, beri waktu microtask).
    await vi.waitFor(() => {
      expect(customerService.updateCustomerZipcodeIfEmpty).toHaveBeenCalledWith(
        'cust-zip-rawtext',
        '61256',
        TENANT
      );
    });
  });

  it('tidak menimpa zipcode customer yang sudah ada', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({
      id: 'cust-zip-existing',
      tenant_id: TENANT,
      phone: PHONE,
      name: 'Bunda Zip Test',
      zipcode: '60111',
      pending_zipcode: null,
      kelurahan: 'Keputih',
      kecamatan: 'Sukolilo',
      kota: 'Surabaya',
      preferences: {},
      created_at: new Date(),
    } as any);

    const result = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-zip-existing', phone: PHONE, name: 'Bunda Zip Test' },
      tenantId: TENANT,
      reservationId: 'res-zip-existing',
      eventTime: Math.floor(Date.now() / 1000),
      value: 150000,
    });

    expect(result.success).toBe(true);
    const expectedZipHash = new ParamBuilder().getNormalizedAndHashedPII(
      '60111',
      PII_DATA_TYPE.ZIP_CODE
    );
    expect(sentPayload?.data?.[0]?.user_data?.zp).toEqual([expectedZipHash]);
    expect(customerService.updateCustomerZipcodeIfEmpty).not.toHaveBeenCalled();
  });
});
