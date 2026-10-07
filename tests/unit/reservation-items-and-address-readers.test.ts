import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { prisma } from '../../src/db/client';

describe('Fase 3C / 3.9 — Reservation Items & Address Readers Integration', () => {
  const tenantId = 'default-tenant';
  const customerId = 'cust-reader-test-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saveReservation menyimpan customer_address_id bila diberikan eksplisit', async () => {
    const mockCreated = {
      id: 'res-addr-test-1',
      tenant_id: tenantId,
      customer_id: customerId,
      treatment_detail: 'Pijat Bayi Ceria',
      booking_date: new Date('2026-10-10T09:00:00.000Z'),
      customer_address_id: 'addr-custom-123',
      status: 'confirmed',
    };

    const createSpy = vi.spyOn(prisma.reservation, 'create').mockResolvedValue(mockCreated as any);
    const countSpy = vi.spyOn(prisma.staff, 'count').mockResolvedValue(5 as any);
    const resCountSpy = vi.spyOn(prisma.reservation, 'count').mockResolvedValue(0 as any);
    const findManySpy = vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([] as any);

    const result = await reservationCoreService.saveReservation({
      tenantId,
      customerId,
      bookingDate: new Date('2026-10-10T09:00:00.000Z'),
      treatmentDetail: 'Pijat Bayi Ceria',
      customerAddressId: 'addr-custom-123',
      source: 'ADMIN_PANEL',
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customer_address_id: 'addr-custom-123',
        }),
      })
    );
    expect(result.reservation.id).toBe('res-addr-test-1');
  });

  it('saveReservation meneruskan items terstruktur dan menyinkronkan ke reservationItem', async () => {
    const mockCreated = {
      id: 'res-items-test-2',
      tenant_id: tenantId,
      customer_id: customerId,
      treatment_detail: 'Pijat Bayi + Sinar Moksa',
      booking_date: new Date('2026-10-10T10:00:00.000Z'),
      status: 'confirmed',
    };

    vi.spyOn(prisma.reservation, 'create').mockResolvedValue(mockCreated as any);
    vi.spyOn(prisma.staff, 'count').mockResolvedValue(5 as any);
    vi.spyOn(prisma.reservation, 'count').mockResolvedValue(0 as any);
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([] as any);

    const deleteManySpy = vi.spyOn(prisma.reservationItem, 'deleteMany').mockResolvedValue({ count: 0 } as any);
    const createManySpy = vi.spyOn(prisma.reservationItem, 'createMany').mockResolvedValue({ count: 2 } as any);

    const structuredItems = [
      { serviceName: 'Pijat Bayi', price: 120000, durationMinutes: 60 },
      { serviceName: 'Sinar Moksa', price: 50000, durationMinutes: 30 },
    ];

    const result = await reservationCoreService.saveReservation({
      tenantId,
      customerId,
      bookingDate: new Date('2026-10-10T10:00:00.000Z'),
      treatmentDetail: 'Pijat Bayi + Sinar Moksa',
      items: structuredItems,
      source: 'ADMIN_PANEL',
    });

    expect(result.reservation.id).toBe('res-items-test-2');
    expect(deleteManySpy).toHaveBeenCalledWith({ where: { reservation_id: 'res-items-test-2' } });
    expect(createManySpy).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          reservation_id: 'res-items-test-2',
          custom_name: 'Pijat Bayi',
          price: 120000,
        }),
        expect.objectContaining({
          reservation_id: 'res-items-test-2',
          custom_name: 'Sinar Moksa',
          price: 50000,
        }),
      ]),
    });
  });
});
