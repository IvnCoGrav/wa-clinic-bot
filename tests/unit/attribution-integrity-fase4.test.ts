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

  it('2. Repeat customer yang klik Web CTA baru tidak menabrak P2002 @@unique([tenant_id, trackingCode]) — delete incoming lebih dulu dalam transaksi', async () => {
    // Simulasi tabel AdClick in-memory yang BENAR-BENAR menegakkan unique constraint DB:
    // - @@unique([tenant_id, trackingCode])
    // - @unique customerId
    const rows = new Map<string, any>([
      [
        'existing-ad-click-1',
        {
          id: 'existing-ad-click-1',
          tenant_id: tenantId,
          customerId: 'cust-repeat-1',
          trackingCode: 'PROMO-LAMA',
          utmCampaign: 'PROMO-LAMA',
          utmSource: 'whatsapp_direct',
        },
      ],
      [
        'incoming-ad-click-2',
        {
          id: 'incoming-ad-click-2',
          tenant_id: tenantId,
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
        },
      ],
    ]);

    const callOrder: string[] = [];

    const txMock = {
      adClick: {
        delete: vi.fn().mockImplementation(async ({ where }: any) => {
          callOrder.push(`delete:${where.id}`);
          const row = rows.get(where.id);
          rows.delete(where.id);
          return row;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }: any) => {
          callOrder.push(`update:${where.id}`);
          // Tegakkan unique constraint (tenant_id, trackingCode) seperti PostgreSQL
          for (const [otherId, otherRow] of rows.entries()) {
            if (
              otherId !== where.id &&
              otherRow.tenant_id === tenantId &&
              otherRow.trackingCode === data.trackingCode
            ) {
              const err: any = new Error('Unique constraint failed on the fields: (`tenant_id`,`trackingCode`)');
              err.code = 'P2002';
              throw err;
            }
          }
          const updated = { ...rows.get(where.id), ...data };
          rows.set(where.id, updated);
          return updated;
        }),
      },
    };

    vi.mocked(prisma.adClick.findUnique).mockResolvedValue(rows.get('existing-ad-click-1'));
    vi.mocked(prisma.adClick.findFirst).mockResolvedValue(rows.get('incoming-ad-click-2'));
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(txMock));

    const sendSpy = vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({ success: true } as any);

    const result = await matchAdClickAndFireContact({
      bodyText: 'Promo[PROMO-BARU-2026] Halo Kak mau tanya promo baru',
      isNewCustomerRecord: false,
      customer: { id: 'cust-repeat-1', phone: '08123456789', name: 'Bunda Rina' },
      tenantId,
    });

    expect(result.matched).toBe(true);
    // WAJIB delete incomingClick LEBIH DULU sebelum update existingAdClick agar bebas P2002
    expect(callOrder).toEqual(['delete:incoming-ad-click-2', 'update:existing-ad-click-1']);
    expect(rows.size).toBe(1);
    expect(rows.get('existing-ad-click-1').trackingCode).toBe('PROMO-BARU-2026');
    expect(rows.get('existing-ad-click-1').fbclid).toBe('NEW_FBCLID_999');
    expect(sendSpy).toHaveBeenCalled();
  });

  it('2b. Teks kurung siku arbitrer ([Pijat Bayi]) tanpa prefix Promo dan tanpa Web CTA DB tidak menciptakan AdClick palsu', async () => {
    vi.mocked(prisma.adClick.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.adClick.updateMany).mockResolvedValue({ count: 0 } as any);
    const createSpy = vi.mocked(prisma.adClick.create);

    const result = await matchAdClickAndFireContact({
      bodyText: 'Halo kak mau tanya [Pijat Bayi] untuk usia 4 bulan',
      isNewCustomerRecord: true,
      customer: { id: 'cust-organic-bracket', phone: '081299988877' },
      tenantId,
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(result.matched).toBe(false);
  });

  it('2c. A-003 (Data-Driven format_visit): tenant dengan format_visit kustom (Ref[%ID%] atau [%ID%]) didukung tanpa hardcode Promo', async () => {
    vi.mocked(prisma.adClick.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.adClick.updateMany).mockResolvedValue({ count: 0 } as any);
    const createSpy = vi.mocked(prisma.adClick.create).mockImplementation(async (args: any) => ({
      id: 'direct-custom',
      ...args.data,
    } as any));
    vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({ success: true } as any);

    // Tenant A: format_visit = 'Ref[%ID%]'
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({ id: 'tenant-ref', format_visit: 'Ref[%ID%]' } as any);
    const resRef = await matchAdClickAndFireContact({
      bodyText: 'Ref[IG-CUSTOM-1] Halo mau booking',
      isNewCustomerRecord: true,
      customer: { id: 'cust-ref-1', phone: '6285711112222' },
      tenantId: 'tenant-ref',
    });
    expect(resRef.matched).toBe(true);
    expect(resRef.adClick?.utmCampaign).toBe('IG-CUSTOM-1');

    // Tenant B: format_visit = '[%ID%]' (tanpa prefix) -> terima token kode tanpa spasi, tetap tolak frasa bebas [Pijat Bayi]
    createSpy.mockClear();
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({ id: 'tenant-bare', format_visit: '[%ID%]' } as any);
    const resBare = await matchAdClickAndFireContact({
      bodyText: '[IG-NOPREFIX] Halo kak',
      isNewCustomerRecord: true,
      customer: { id: 'cust-bare-1', phone: '6285711113333' },
      tenantId: 'tenant-bare',
    });
    expect(resBare.matched).toBe(true);
    expect(resBare.adClick?.utmCampaign).toBe('IG-NOPREFIX');

    createSpy.mockClear();
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({ id: 'tenant-bare', format_visit: '[%ID%]' } as any);
    const resPhrase = await matchAdClickAndFireContact({
      bodyText: 'Mau tanya [Pijat Bayi] dong',
      isNewCustomerRecord: true,
      customer: { id: 'cust-bare-2', phone: '6285711114444' },
      tenantId: 'tenant-bare',
    });
    expect(resPhrase.matched).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('3. Dedup Browser↔Server (P0-3): event dengan counterpart browser mempertahankan trackingCode murni; event server-only memakai suffix', async () => {
    let capturedPayload: any = null;
    vi.mocked(axios.post).mockImplementation(async (_url: any, payload: any) => {
      capturedPayload = payload;
      return { status: 200, data: { events_received: 1 } };
    });

    // Browser pixel mengirim eventID: trackingCode; Meta dedup berbasis pasangan (event_name, event_id)
    for (const browserEvent of ['Contact', 'Lead', 'InitiateCheckout', 'AddToCart']) {
      await capiService.sendCapiEvent({
        eventName: browserEvent,
        customer: { id: 'cust-dedup-test', phone: '08123456789' },
        adClick: { trackingCode: 'CAMPAIGN_CODE_123' },
        tenantId,
      });
      expect(capturedPayload.data[0].event_id).toBe('CAMPAIGN_CODE_123');
    }

    // Event server-only tanpa counterpart browser mendapat suffix eventName
    await capiService.sendCapiEvent({
      eventName: 'CustomServerSignal',
      customer: { id: 'cust-dedup-test', phone: '08123456789' },
      adClick: { trackingCode: 'CAMPAIGN_CODE_123' },
      tenantId,
    });
    expect(capturedPayload.data[0].event_id).toBe('CAMPAIGN_CODE_123_customserversignal');
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
