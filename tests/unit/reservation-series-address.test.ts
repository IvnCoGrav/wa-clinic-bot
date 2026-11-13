import { describe, it, expect, vi, beforeEach } from 'vitest';

const createCalls: any[] = [];

vi.mock('../../src/db/client', () => ({
  prisma: {
    reservationSeries: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    reservation: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    customer: {
      update: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => {
      if (typeof fn !== 'function') return Promise.all(fn);
      const tx = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
        reservationSeries: {
          create: vi.fn().mockImplementation(async ({ data }: any) => ({
            id: 'series-address-1',
            customer_id: data.customer_id,
            treatment_name: data.treatment_name,
            total_sessions: data.total_sessions,
            purchase_value: data.purchase_value ?? null,
            assigned_staff_id: data.assigned_staff_id ?? null,
            notes: data.notes ?? null,
            status: 'active',
            created_at: new Date(),
          })),
        },
        reservation: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            createCalls.push(data);
            return {
              id: `res-series-${data.session_number}`,
              session_number: data.session_number,
              booking_date: data.booking_date,
              status: data.status,
              assigned_staff_id: data.assigned_staff_id,
            };
          }),
          findMany: vi.fn().mockResolvedValue([]),
          update: vi.fn(),
        },
        reservationItem: {
          create: vi.fn().mockResolvedValue({ id: 'item-1' }),
        },
      };
      return fn(tx);
    }),
  },
}));

vi.mock('../../src/services/customer.service', () => ({
  customerService: {
    resolveOwnedAddressCard: vi.fn(),
    recalculateCustomerLtv: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/services/treatment-catalog.service', () => ({
  treatmentCatalogService: {
    getAllServices: vi.fn(() => [{ id: 'baby-1', name: 'Pijat Bayi', category: 'BABY' }]),
    findServiceByName: vi.fn(() => undefined),
  },
}));

vi.mock('../../src/services/google-calendar.service', () => ({
  googleCalendarService: {
    createEvent: vi.fn(),
    syncReservation: vi.fn(),
  },
}));

vi.mock('../../src/services/reservation-lifecycle.service', () => ({
  reservationLifecycleService: { onReservationCreated: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/services/follow-up.service', () => ({
  followUpService: { createReservationFollowUps: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/services/staff-notification.service', () => ({
  staffNotificationService: { scheduleReservationAssignmentNotification: vi.fn().mockResolvedValue(undefined) },
}));

import { reservationSeriesService } from '../../src/services/reservation-series.service';
import { customerService } from '../../src/services/customer.service';

const CARD = {
  id: 'card-buduran',
  label: 'Rumah Buduran',
  address: 'Perum Buduran Indah Blok B-5',
  kelurahan: 'Buduran',
  kecamatan: 'Buduran',
  kota: 'Sidoarjo',
  lat: -7.4255,
  lng: 112.7214,
  distanceKm: 18.0,
  ongkir: 22000,
  landmark: null,
  locationSource: 'manual_staff',
  isPrimary: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: '2026-01-01T00:00:00.000Z',
};

const BASE_PARAMS = {
  customerId: 'cust-series-address',
  treatmentName: 'Pijat Bayi',
  treatmentCategory: 'BABY',
  totalSessions: 2,
  purchaseValue: 200000,
  sessions: [
    { sessionNumber: 1, bookingDate: new Date('2026-12-01T09:00:00Z') },
    { sessionNumber: 2, bookingDate: new Date('2026-12-02T09:00:00Z') },
  ],
};

describe('ReservationSeriesService — kartu alamat level series', () => {
  beforeEach(() => {
    createCalls.length = 0;
    vi.clearAllMocks();
    vi.mocked(customerService.recalculateCustomerLtv).mockResolvedValue(undefined as any);
  });

  it('kartu valid → semua sesi memakai customer_address_id & delivery_fee dari kartu', async () => {
    vi.mocked(customerService.resolveOwnedAddressCard).mockResolvedValue(CARD as any);

    const result = await reservationSeriesService.createSeries(
      { ...BASE_PARAMS, customerAddressId: CARD.id } as any,
      'default-tenant'
    );

    expect(result.reservations).toHaveLength(2);
    expect(customerService.resolveOwnedAddressCard).toHaveBeenCalledWith(
      BASE_PARAMS.customerId,
      CARD.id,
      'default-tenant'
    );
    expect(createCalls).toHaveLength(2);
    for (const data of createCalls) {
      expect(data.customer_address_id).toBe(CARD.id);
      expect(data.delivery_fee).toBe(CARD.ongkir);
    }
  });

  it('kartu tidak ada / bukan milik customer → error CUSTOMER_ADDRESS_NOT_FOUND, tanpa transaksi', async () => {
    vi.mocked(customerService.resolveOwnedAddressCard).mockResolvedValue(null);

    await expect(
      reservationSeriesService.createSeries(
        { ...BASE_PARAMS, customerAddressId: 'card-punya-orang-lain' } as any,
        'default-tenant'
      )
    ).rejects.toMatchObject({ code: 'CUSTOMER_ADDRESS_NOT_FOUND' });
    expect(createCalls).toHaveLength(0);
  });

  it('kartu per-sesi berbeda → error SERIES_MULTIPLE_ADDRESS_NOT_SUPPORTED', async () => {
    await expect(
      reservationSeriesService.createSeries(
        {
          ...BASE_PARAMS,
          sessions: [
            { sessionNumber: 1, bookingDate: new Date('2026-12-01T09:00:00Z'), customerAddressId: 'card-a' },
            { sessionNumber: 2, bookingDate: new Date('2026-12-02T09:00:00Z'), customerAddressId: 'card-b' },
          ],
        } as any,
        'default-tenant'
      )
    ).rejects.toMatchObject({ code: 'SERIES_MULTIPLE_ADDRESS_NOT_SUPPORTED' });
    expect(createCalls).toHaveLength(0);
  });
});
