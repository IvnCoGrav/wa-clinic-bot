import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { runHeal, hasWaGpsEvidence } from '../../src/scripts/heal-single-card-provenance';

function makeCustomer(overrides: any = {}) {
  return {
    id: 'cust-1',
    tenant_id: DEFAULT_TENANT_ID,
    name: 'Bunda Ririn',
    phone: '628111',
    lat: -7.29,
    lng: 112.8,
    location_source: 'manual_staff',
    share_location_sent: true,
    preferences: { saved_addresses: [{ id: 'card-1', isPrimary: true, address: 'Gayungan', locationSource: 'manual_staff' }] },
    addresses: [
      {
        id: 'card-1',
        lat: -7.29,
        lng: 112.8,
        location_source: 'manual_staff',
        address: 'Gayungan',
        landmark: null,
        kelurahan: 'Gayungan',
        last_used_at: new Date('2026-01-01'),
      },
    ],
    ...overrides,
  };
}

describe('heal-single-card-provenance (F4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('payload auditLog.create bertipe string (A-004)', async () => {
    const cust = makeCustomer();
    vi.mocked((prisma as any).customer.findMany).mockResolvedValue([cust]);
    vi.mocked((prisma as any).$queryRawUnsafe).mockResolvedValue([
      { lat: '-7.29', lng: '112.8', addr: 'Jl. Rungkut No. 1', name: 'Patokan A' },
    ]);

    const tx = {
      customerAddress: { update: vi.fn().mockResolvedValue({}) },
      customer: { update: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    vi.mocked((prisma as any).$transaction).mockImplementation(async (fn: any) => fn(tx));

    const res = await runHeal({ commit: true, tenantId: DEFAULT_TENANT_ID });
    expect(res.candidates).toBe(1);
    expect(res.applied).toBe(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    const payload = tx.auditLog.create.mock.calls[0][0].data.payload;
    expect(typeof payload).toBe('string');
    expect(() => JSON.parse(payload)).not.toThrow();
  });

  it('--dry-run → 0 panggilan customerAddress.update', async () => {
    const cust = makeCustomer();
    vi.mocked((prisma as any).customer.findMany).mockResolvedValue([cust]);
    vi.mocked((prisma as any).$queryRawUnsafe).mockResolvedValue([]);

    const tx = {
      customerAddress: { update: vi.fn() },
      customer: { update: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    vi.mocked((prisma as any).$transaction).mockImplementation(async (fn: any) => fn(tx));

    const res = await runHeal({ commit: false, tenantId: DEFAULT_TENANT_ID });
    expect(res.candidates).toBe(1);
    expect(res.applied).toBe(0);
    expect(tx.customerAddress.update).not.toHaveBeenCalled();
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('--commit 1 kandidat → 1 update kartu + 1 update customer + 1 audit; last_used_at tidak diubah', async () => {
    const cust = makeCustomer();
    vi.mocked((prisma as any).customer.findMany).mockResolvedValue([cust]);
    vi.mocked((prisma as any).$queryRawUnsafe).mockResolvedValue([]);

    const tx = {
      customerAddress: { update: vi.fn().mockResolvedValue({}) },
      customer: { update: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    vi.mocked((prisma as any).$transaction).mockImplementation(async (fn: any) => fn(tx));

    const res = await runHeal({ commit: true, tenantId: DEFAULT_TENANT_ID });
    expect(res.applied).toBe(1);
    expect(tx.customerAddress.update).toHaveBeenCalledTimes(1);
    expect(tx.customer.update).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    const cardData = tx.customerAddress.update.mock.calls[0][0].data;
    expect(cardData.last_used_at).toBeUndefined();
    expect(cardData.location_source).toBe('gps_pin');
    const custData = tx.customer.update.mock.calls[0][0].data;
    expect(custData.location_source).toBe('gps_pin');
    expect(custData.preferences.location_source).toBe('gps_pin');
    expect(custData.preferences.location_source_label).toBeUndefined();
  });

  it('kandidat dengan sumber bidan_shareloc saja → ditolak (A-001/F3)', async () => {
    const cust = makeCustomer({
      share_location_sent: false,
      location_source: 'gps_pin',
      preferences: { pin_from_staff_at: '2026-09-01T00:00:00Z', location_source: 'bidan_shareloc' },
    });
    vi.mocked((prisma as any).customer.findMany).mockResolvedValue([cust]);
    vi.mocked((prisma as any).$queryRawUnsafe).mockResolvedValue([]);

    const res = await runHeal({ commit: true, tenantId: DEFAULT_TENANT_ID });
    expect(res.candidates).toBe(0);
    expect(hasWaGpsEvidence(cust)).toBe(false);
  });

  it('tanpa --tenant → hanya tenant default (bukan semua tenant)', async () => {
    vi.mocked((prisma as any).customer.findMany).mockResolvedValue([]);
    await runHeal({});
    expect((prisma as any).customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenant_id: DEFAULT_TENANT_ID }),
      })
    );
  });
});
