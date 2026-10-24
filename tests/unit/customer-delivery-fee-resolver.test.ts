import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('customerService.getLastDeliveryFee (SSOT Ongkir Promo Hierarchy)', () => {
  const tenantId = DEFAULT_TENANT_ID;
  const customerId = 'cust-test-123';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Prioritas 1: Mengambil snapshot delivery_fee dari reservasi terakhir yang valid', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue({
      delivery_fee: 25000,
    } as any);

    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
      ongkir: 35000,
      preferences: {
        distance_estimate: { ongkir: 20000 },
        saved_addresses: [{ isPrimary: true, ongkir: 15000 }],
      },
    } as any);

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBe(25000);
  });

  it('Prioritas 2: Mengambil distance_estimate.ongkir dari chat WhatsApp jika reservasi belum ada', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);

    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
      ongkir: 35000, // Legacy profile fee
      preferences: {
        distance_estimate: { ongkir: 25000, by: 'admin_chat' },
        saved_addresses: [{ isPrimary: true, ongkir: 30000 }],
      },
    } as any);

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBe(25000);
  });

  it('Prioritas 3: Mengambil primary saved_addresses ongkir jika estimasi chat kosong', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);

    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
      ongkir: 35000,
      preferences: {
        distance_estimate: null,
        saved_addresses: [
          { id: 'addr-1', isPrimary: false, ongkir: 20000 },
          { id: 'addr-2', isPrimary: true, ongkir: 15000 },
        ],
      },
    } as any);

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBe(15000);
  });

  it('Prioritas 4: Fallback ke Customer.ongkir jika seluruh preferensi kosong', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);

    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
      ongkir: 35000,
      preferences: {},
    } as any);

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBe(35000);
  });

  it('Mengembalikan null jika tidak ada data sama sekali atau DB offline', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockRejectedValue(new Error('Database offline'));
    vi.spyOn(prisma.customer, 'findFirst').mockRejectedValue(new Error('Database offline'));

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBeNull();
  });
});
