import { describe, it, expect, vi, beforeEach } from 'vitest';

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
      findMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    customer: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => {
      if (typeof fn === 'function') {
        const tx = {
          reservationSeries: {
            create: vi.fn().mockImplementation(async ({ data }: any) => ({
              id: 'series_1',
              customer_id: data.customer_id,
              treatment_name: data.treatment_name,
              total_sessions: data.total_sessions,
              purchase_value: data.purchase_value ?? 100,
              delivery_fee: data.delivery_fee ?? null,
              discount_amount: data.discount_amount ?? null,
              payment_method: data.payment_method ?? null,
              duration_minutes: data.duration_minutes ?? null,
              customer_address_id: data.customer_address_id ?? null,
              request_id: data.request_id ?? null,
              assigned_staff_id: data.assigned_staff_id ?? null,
              notes: data.notes ?? null,
              status: 'active',
              created_at: new Date(),
            })),
          },
          reservation: {
            create: vi.fn().mockImplementation(async ({ data }: any) => ({
              id: `res_${data.session_number}`,
              session_number: data.session_number,
              booking_date: data.booking_date,
              status: data.status,
              assigned_staff_id: data.assigned_staff_id,
              treatment_category: data.treatment_category,
              delivery_fee: data.delivery_fee,
              discount_amount: data.discount_amount,
              payment_method: data.payment_method,
              duration_minutes: data.duration_minutes,
              customer_address_id: data.customer_address_id,
            })),
          },
        };
        return fn(tx);
      }
      return Promise.all(fn.map((p: any) => p));
    }),
  },
}));

vi.mock('../../src/services/customer.service', () => ({
  customerService: { recalculateCustomerLtv: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/services/treatment-catalog.service', () => ({
  treatmentCatalogService: {
    getAllServices: vi.fn(() => [{ id: 'moms-prenatal-massage', name: 'Prenatal Massage (Pijat Hamil)', category: 'MOMS' }]),
    findServiceByName: vi.fn(() => undefined),
  },
}));

vi.mock('../../src/services/google-calendar.service', () => ({
  googleCalendarService: {
    createEvent: vi.fn().mockResolvedValue('evt_1'),
    syncReservation: vi.fn().mockResolvedValue(undefined),
    updateEvent: vi.fn().mockResolvedValue(undefined),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/services/reservation-lifecycle.service', () => ({
  reservationLifecycleService: { onReservationCreated: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/services/follow-up.service', () => ({
  followUpService: {
    createReservationFollowUps: vi.fn().mockResolvedValue(undefined),
    onReservationCancelled: vi.fn().mockResolvedValue(undefined),
    onReservationRescheduled: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/services/staff-notification.service', () => ({
  staffNotificationService: { scheduleReservationAssignmentNotification: vi.fn().mockResolvedValue(undefined) },
}));

import { reservationSeriesService } from '../../src/services/reservation-series.service';
import { customerService } from '../../src/services/customer.service';
import { reservationLifecycleService } from '../../src/services/reservation-lifecycle.service';
import { followUpService } from '../../src/services/follow-up.service';
import { staffNotificationService } from '../../src/services/staff-notification.service';
import { prisma } from '../../src/db/client';

describe('ReservationSeriesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. createSeries creates N reservations with dynamic category (not hardcoded BABY)', async () => {
    const future1 = new Date(Date.now() + 86400000);
    const future2 = new Date(Date.now() + 2 * 86400000);
    const series = await reservationSeriesService.createSeries({
      customerId: 'cust_1',
      treatmentName: 'Prenatal Massage (Pijat Hamil)',
      treatmentCategory: 'MOMS',
      totalSessions: 2,
      purchaseValue: 200000,
      sessions: [
        { sessionNumber: 1, bookingDate: future1 },
        { sessionNumber: 2, bookingDate: future2 },
      ],
    } as any, 'default-tenant');
    expect(series.totalSessions).toBe(2);
    expect(series.reservations).toHaveLength(2);
    expect(series.treatmentName).toBe('Prenatal Massage (Pijat Hamil)');
  });

  it('1b. createSeries resolves category from catalog when not explicit', async () => {
    const future1 = new Date(Date.now() + 86400000);
    const series = await reservationSeriesService.createSeries({
      customerId: 'cust_1',
      treatmentName: 'Prenatal Massage (Pijat Hamil)',
      totalSessions: 1,
      sessions: [{ sessionNumber: 1, bookingDate: future1 }],
    } as any, 'default-tenant');
    expect(series.totalSessions).toBe(1);
  });

  it('2. createSeries and cancelSeries trigger ltv_cache', async () => {
    const future1 = new Date(Date.now() + 86400000);
    await reservationSeriesService.createSeries({
      customerId: 'cust_1', treatmentName: 'Pijat Bayi Ceria', totalSessions: 1,
      sessions: [{ sessionNumber: 1, bookingDate: future1 }],
    } as any, 'default-tenant');
    expect(customerService.recalculateCustomerLtv).toHaveBeenCalledWith('cust_1', 'default-tenant');

    vi.mocked(prisma.reservationSeries.findFirst).mockResolvedValueOnce({
      id: 'series_1', customer_id: 'cust_1', tenant_id: 'default-tenant', treatment_name: 'Pijat', total_sessions: 1, status: 'active',
      reservations: [{ id: 'r1', status: 'pending' } as any],
    } as any);
    await reservationSeriesService.cancelSeries('series_1', 'default-tenant');
    expect(customerService.recalculateCustomerLtv).toHaveBeenCalledWith('cust_1', 'default-tenant');
  });

  it('3. updateSession handles status update & sanitizes empty staffId to null', async () => {
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({ id: 'r1', customer_id: 'cust_1', status: 'completed' } as any);
    const updated = await reservationSeriesService.updateSession('r1', { assignedStaffId: '', status: 'completed' } as any, 'default-tenant');
    const callArg = vi.mocked(prisma.reservation.update).mock.calls[0][0] as any;
    expect(callArg.data.assigned_staff_id).toBeNull();
    expect(callArg.data.status).toBe('completed');
    expect(customerService.recalculateCustomerLtv).toHaveBeenCalled();
    expect(updated).toBeDefined();
  });

  it('3b. updateSession reassign staf ke slot bentrok → STAFF_COLLISION (paritas jalur utama)', async () => {
    const futureTarget = new Date(Date.now() + 86400000);
    const futureConflict = new Date(futureTarget.getTime() - 15 * 60000);
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'r1', booking_date: futureTarget, status: 'confirmed', duration_minutes: 60,
    } as any);
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: 'ex', booking_date: futureConflict, duration_minutes: 60, assigned_staff_id: 'staff_1', status: 'confirmed' },
    ] as any);

    await expect(
      reservationSeriesService.updateSession('r1', { assignedStaffId: 'staff_1' } as any, 'default-tenant')
    ).rejects.toMatchObject({ code: 'STAFF_COLLISION' });
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('4. getSeries and getCustomerSeries return computed completed_sessions', async () => {
    vi.mocked(prisma.reservationSeries.findFirst).mockResolvedValueOnce({
      id: 's1', customer_id: 'cust_1', tenant_id: 'default-tenant', treatment_name: 'Pijat', total_sessions: 3, status: 'active',
      reservations: [
        { id: 'r1', status: 'completed' }, { id: 'r2', status: 'completed' }, { id: 'r3', status: 'pending' },
      ],
      customer: { id: 'cust_1', name: 'Bunda', phone: '6281' }, assigned_staff: null,
    } as any);
    const single = await reservationSeriesService.getSeries('s1', 'default-tenant');
    expect(single?.completed_sessions).toBe(2);
    expect(single?.pending_sessions).toBe(1);

    vi.mocked(prisma.reservationSeries.findMany).mockResolvedValueOnce([
      { id: 's1', customer_id: 'cust_1', tenant_id: 'default-tenant', treatment_name: 'Pijat', total_sessions: 2, status: 'active', reservations: [{ id: 'r1', status: 'completed' }, { id: 'r2', status: 'pending' }], assigned_staff: null } as any,
    ]);
    const list = await reservationSeriesService.getCustomerSeries('cust_1', 'default-tenant');
    expect(list[0].completed_sessions).toBe(1);
  });

  it('5. Fase 3.3 — sesi bentrok staf → series ditolak atomik (STAFF_COLLISION)', async () => {
    const futureSlot = new Date(Date.now() + 86400000);
    const futureNew = new Date(futureSlot.getTime() + 30 * 60000);
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: 'ex', booking_date: futureSlot, duration_minutes: 60, assigned_staff_id: 'staff_1' },
    ] as any);
    await expect(
      reservationSeriesService.createSeries({
        customerId: 'cust_1', treatmentName: 'Prenatal Massage (Pijat Hamil)', totalSessions: 1,
        assignedStaffId: 'staff_1',
        sessions: [{ sessionNumber: 1, bookingDate: futureNew, assignedStaffId: 'staff_1' }],
      } as any, 'default-tenant')
    ).rejects.toMatchObject({ code: 'STAFF_COLLISION' });
  });

  it('6. FIX 173i-e — createSeries menjalankan efek samping lifecycle per sesi', async () => {
    const future1 = new Date(Date.now() + 86400000);
    const future2 = new Date(Date.now() + 2 * 86400000);
    const series = await reservationSeriesService.createSeries({
      customerId: 'cust_1',
      treatmentName: 'Prenatal Massage (Pijat Hamil)',
      treatmentCategory: 'MOMS',
      totalSessions: 2,
      assignedStaffId: 'staff_1',
      sessions: [
        { sessionNumber: 1, bookingDate: future1 },
        { sessionNumber: 2, bookingDate: future2 },
      ],
    } as any, 'default-tenant');

    expect(series.reservations).toHaveLength(2);
    expect(reservationLifecycleService.onReservationCreated).toHaveBeenCalledTimes(2);
    expect(followUpService.createReservationFollowUps).toHaveBeenCalledTimes(2);
    expect(staffNotificationService.scheduleReservationAssignmentNotification).toHaveBeenCalledTimes(2);
  });

  it('7. pre-flight: menolak tanggal sesi masa lalu (PAST_SESSION_DATE)', async () => {
    const pastDate = new Date('2020-01-01T09:00:00Z');
    await expect(
      reservationSeriesService.createSeries({
        customerId: 'cust_1',
        treatmentName: 'Pijat Newborn',
        totalSessions: 1,
        sessions: [{ sessionNumber: 1, bookingDate: pastDate }],
      } as any, 'default-tenant')
    ).rejects.toMatchObject({ code: 'PAST_SESSION_DATE', sessionNumber: 1 });
  });

  it('8. pre-flight: menolak tanggal tidak valid (INVALID_SESSION_DATE)', async () => {
    await expect(
      reservationSeriesService.createSeries({
        customerId: 'cust_1',
        treatmentName: 'Pijat Newborn',
        totalSessions: 1,
        sessions: [{ sessionNumber: 1, bookingDate: 'invalid-date' }],
      } as any, 'default-tenant')
    ).rejects.toMatchObject({ code: 'INVALID_SESSION_DATE', sessionNumber: 1 });
  });

  it('9. idempotensi: request_id yang sama mengembalikan series yang sudah ada tanpa insert ganda', async () => {
    const futureDate = new Date(Date.now() + 86400000);
    vi.mocked(prisma.reservationSeries.findFirst).mockResolvedValueOnce({
      id: 'series_existing',
      customer_id: 'cust_1',
      treatment_name: 'Paket Newborn 7 Hari',
      total_sessions: 7,
      purchase_value: 700000,
      delivery_fee: 15000,
      discount_amount: 50000,
      payment_method: 'transfer_bca',
      duration_minutes: 60,
      customer_address_id: 'addr_1',
      request_id: 'req_123',
      status: 'active',
      assigned_staff_id: null,
      notes: null,
      created_at: new Date(),
      reservations: [
        { id: 'r1', session_number: 1, booking_date: futureDate, status: 'confirmed', assigned_staff_id: null },
      ],
    } as any);

    const series = await reservationSeriesService.createSeries({
      customerId: 'cust_1',
      treatmentName: 'Paket Newborn 7 Hari',
      totalSessions: 1,
      requestId: 'req_123',
      sessions: [{ sessionNumber: 1, bookingDate: futureDate }],
    } as any, 'default-tenant');

    expect(series.id).toBe('series_existing');
    expect(series.deliveryFee).toBe(15000);
  });

  it('10. propagasi field komersial ke series dan tiap reservasi sesi', async () => {
    const future1 = new Date(Date.now() + 86400000);
    const series = await reservationSeriesService.createSeries({
      customerId: 'cust_1',
      treatmentName: 'Paket Newborn 7 Hari',
      totalSessions: 1,
      purchaseValue: 700000,
      deliveryFee: 20000,
      discountAmount: 30000,
      paymentMethod: 'cash',
      customerAddressId: 'addr_123',
      durationMinutes: 90,
      sessions: [{ sessionNumber: 1, bookingDate: future1 }],
    } as any, 'default-tenant');

    expect(series.deliveryFee).toBe(20000);
    expect(series.discountAmount).toBe(30000);
    expect(series.paymentMethod).toBe('cash');
    expect(series.durationMinutes).toBe(90);
    expect(series.customerAddressId).toBe('addr_123');
  });

  it('11. cancelSeries membatalkan follow-up dan gcal untuk tiap sesi', async () => {
    vi.mocked(prisma.reservationSeries.findFirst).mockResolvedValueOnce({
      id: 'series_1', customer_id: 'cust_1', tenant_id: 'default-tenant', treatment_name: 'Pijat', total_sessions: 2, status: 'active',
      reservations: [
        { id: 'r1', status: 'confirmed' },
        { id: 'r2', status: 'pending' },
      ],
    } as any);

    const res = await reservationSeriesService.cancelSeries('series_1', 'default-tenant');
    expect(res.cancelledCount).toBe(2);
    expect(followUpService.onReservationCancelled).toHaveBeenCalledWith('r1', 'default-tenant');
    expect(followUpService.onReservationCancelled).toHaveBeenCalledWith('r2', 'default-tenant');
  });

  it('12. updateSession menyinkronkan rescheduling follow-up dan gcal', async () => {
    const futureNew = new Date(Date.now() + 3 * 86400000);
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
      id: 'r1', customer_id: 'cust_1', booking_date: futureNew, status: 'confirmed',
    } as any);

    await reservationSeriesService.updateSession('r1', { bookingDate: futureNew }, 'default-tenant');
    expect(followUpService.onReservationRescheduled).toHaveBeenCalledWith('r1', futureNew, 'default-tenant');
  });
});
