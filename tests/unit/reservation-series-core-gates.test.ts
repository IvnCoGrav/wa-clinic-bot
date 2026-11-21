import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reservationSeriesService } from '../../src/services/reservation-series.service';
import { prisma } from '../../src/db/client';

vi.mock('../../src/services/treatment-catalog.service', () => ({
  treatmentCatalogService: {
    getAllServices: vi.fn(() => [{ id: 'moms-massage', name: 'Pijat Hamil', category: 'MOMS' }]),
    findServiceByName: vi.fn(() => undefined),
  },
}));

vi.mock('../../src/services/customer.service', () => ({
  customerService: { recalculateCustomerLtv: vi.fn().mockResolvedValue(undefined) },
}));

describe('A-004: Reservation Series Core Gates (Fase 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('0.4: createSeries harus menolak dengan DUPLICATE_BOOKING bila customer sudah memiliki reservasi aktif di slot yang sama', async () => {
    // Tanggal relatif (bukan hardcode) agar test tidak menjadi time-bomb setelah
    // tanggal tertentu. Lihat KNOWN_ISSUES #366.
    const futureDate = (daysAhead: number, hourUtc = 10): Date => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + daysAhead);
      d.setUTCHours(hourUtc, 0, 0, 0);
      return d;
    };
    const bookingDate = futureDate(30);

    // Customer sudah memiliki reservasi di jam tersebut
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      {
        id: 'existing-res-1',
        customer_id: 'cust-duplicate',
        booking_date: bookingDate,
        duration_minutes: 60,
        status: 'confirmed',
      },
    ] as any);

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
        reservationSeries: {
          create: vi.fn().mockResolvedValue({ id: 'series-1', customer_id: 'cust-duplicate' }),
        },
        reservation: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'existing-res-1',
              customer_id: 'cust-duplicate',
              booking_date: bookingDate,
              duration_minutes: 60,
              status: 'confirmed',
            },
          ]),
          create: vi.fn().mockResolvedValue({ id: 'res-series-1', session_number: 1 }),
        },
        reservationItem: {
          create: vi.fn().mockResolvedValue({ id: 'item-1' }),
        },
      };
      return cb(tx);
    });

    // Gate A-004: createSeries harus menolak duplikasi slot customer yang sama.
    await expect(
      reservationSeriesService.createSeries({
        tenantId: 'default-tenant',
        customerId: 'cust-duplicate',
        treatmentName: 'Pijat Hamil',
        totalSessions: 2,
        sessions: [
          { sessionNumber: 1, bookingDate: bookingDate },
          { sessionNumber: 2, bookingDate: futureDate(37) },
        ],
      })
    ).rejects.toMatchObject({
      code: 'DUPLICATE_BOOKING',
    });
  });
});
