import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { capiService, capiBreaker, buildDeterministicPurchaseEventId, buildLegacyPurchaseEventId } from '../../src/services/capi.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { prisma } from '../../src/db/client';

/**
 * Tahap B (A-004/A-005): event_id Purchase WAJIB deterministik dari kunci bisnis:
 * - `pur_{tenantId}_{reservationId}` untuk reservasi walau `event_time`/purchase_occurred_at berubah
 *   (skenario payment proof masuk belakangan lalu force-resend).
 * - Tanpa reservasi: anchor time yang stabil (eventTime/adClick.createdAt/customer.created_at),
 *   BUKAN Date.now() saat pengiriman.
 * - `buildLegacyPurchaseEventId` dipakai dispatch untuk memakai ulang event_id pengiriman
 *   pertama (format lama) pada reservasi yang sudah pernah terkirim sebelum pembaruan ini.
 */
describe('Kedeterminisan event_id Purchase (Tahap B2)', () => {
  const sentPayloads: any[] = [];
  let breakerSpy: any;

  beforeEach(() => {
    sentPayloads.length = 0;
    breakerSpy = vi.spyOn(capiBreaker, 'execute').mockImplementation(async (_url: any, payload: any) => {
      sentPayloads.push(payload);
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

  afterAll(async () => {
    breakerSpy?.mockRestore();
  });

  afterEach(() => {
    breakerSpy?.mockRestore();
  });

  it('1. id deterministik pur_{tenant}_{reservationId}; event_time berubah ID tetap (force-resend)', async () => {
    const base = {
      eventName: 'Purchase',
      customer: { id: 'cust-stab', phone: '081234567890' },
      tenantId: DEFAULT_TENANT_ID,
      value: 150000,
    };

    await capiService.sendCapiEvent({ ...base, reservationId: 'res-stab-1', eventTime: 1790000000 });
    await capiService.sendCapiEvent({ ...base, reservationId: 'res-stab-1', eventTime: 1790000900 });

    const ids = sentPayloads.map((p) => p.data[0].event_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe('pur_default-tenant_res-stab-1');
    expect(ids[1]).toBe(ids[0]);
  });

  it('2. reservasi berbeda menghasilkan event_id berbeda', async () => {
    await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-stab', phone: '081234567890' },
      tenantId: DEFAULT_TENANT_ID,
      reservationId: 'res-stab-1',
      eventTime: 1790000000,
      value: 150000,
    });
    await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-stab', phone: '081234567890' },
      tenantId: DEFAULT_TENANT_ID,
      reservationId: 'res-stab-2',
      eventTime: 1790000000,
      value: 150000,
    });

    const ids = sentPayloads.map((p) => p.data[0].event_id);
    expect(ids[0]).toBe('pur_default-tenant_res-stab-1');
    expect(ids[1]).toBe('pur_default-tenant_res-stab-2');
  });

  it('3. Purchase tanpa reservasi memakai anchor stabil (bukan time-of-send Date.now)', async () => {
    const createdAt = Math.floor(new Date('2026-10-01T08:00:00Z').getTime() / 1000);
    await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-org-event', phone: '081234567890', created_at: new Date('2026-10-01T08:00:00Z') },
      tenantId: DEFAULT_TENANT_ID,
      value: 120000,
    });
    await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'cust-org-event', phone: '081234567890', created_at: new Date('2026-10-01T08:00:00Z') },
      tenantId: DEFAULT_TENANT_ID,
      value: 120000,
    });

    const ids = sentPayloads.map((p) => p.data[0].event_id);
    expect(ids[0]).toBe(`org_pur_cust-org-event_${createdAt}`);
    expect(ids[1]).toBe(ids[0]);
  });

  it('4. helper determinik & legacy menghasilkan kontrak slot resmi', () => {
    expect(buildDeterministicPurchaseEventId(DEFAULT_TENANT_ID, 'res-x')).toBe('pur_default-tenant_res-x');
    expect(buildDeterministicPurchaseEventId(undefined, 'res-x')).toBe('pur_org_res-x');
    expect(
      buildLegacyPurchaseEventId({
        trackingCode: 'promo7',
        reservationId: 'res-y',
        customerId: 'cust-c',
        eventTimeSec: 1790000000,
      })
    ).toBe('promo7_pur_res-y_1790000000');
  });
});
