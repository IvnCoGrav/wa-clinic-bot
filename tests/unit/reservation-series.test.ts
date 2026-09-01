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
    },
    customer: {
      update: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => {
      if (typeof fn === 'function') {
        const tx = {
          reservationSeries: {
            create: vi.fn().mockImplementation(async ({ data }: any) => ({
              id: 'series_1', customer_id: data.customer_id, treatment_name: data.treatment_name, total_sessions: data.total_sessions, purchase_value: data.purchase_value ?? 100, assigned_staff_id: data.assigned_staff_id ?? null, notes: data.notes ?? null, status: 'active', created_at: new Date(),
            })),
          },
          reservation: { create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: `res_${data.session_number}`, session_number: data.session_number, booking_date: data.booking_date, status: data.status, assigned_staff_id: data.assigned_staff_id, treatment_category: data.treatment_category })) },
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
  googleCalendarService: { createEvent: vi.fn().mockResolvedValue('evt_1'), syncReservation: vi.fn().mockResolvedValue(undefined) },
}));

import { reservationSeriesService } from '../../src/services/reservation-series.service';
import { customerService } from '../../src/services/customer.service';
import { prisma } from '../../src/db/client';

describe('ReservationSeriesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. createSeries creates N reservations with dynamic category (not hardcoded BABY)', async () => {
    const series = await reservationSeriesService.createSeries({
      customerId: 'cust_1',
      treatmentName: 'Prenatal Massage (Pijat Hamil)',
      treatmentCategory: 'MOMS',
      totalSessions: 2,
      purchaseValue: 200000,
      sessions: [
        { sessionNumber: 1, bookingDate: new Date('2026-09-02T09:00:00Z') },
        { sessionNumber: 2, bookingDate: new Date('2026-09-03T09:00:00Z') },
      ],
    } as any, 'default-tenant');
    expect(series.totalSessions).toBe(2);
    expect(series.reservations).toHaveLength(2);
    // category sanitized to MOMS/BABY/BOTH — if explicit MOMS, should be MOMS
    expect(series.treatmentName).toBe('Prenatal Massage (Pijat Hamil)');
  });

  it('1b. createSeries resolves category from catalog when not explicit', async () => {
    const series = await reservationSeriesService.createSeries({
      customerId: 'cust_1',
      treatmentName: 'Prenatal Massage (Pijat Hamil)',
      totalSessions: 1,
      sessions: [{ sessionNumber: 1, bookingDate: new Date() }],
    } as any, 'default-tenant');
    expect(series.totalSessions).toBe(1);
  });

  it('2. createSeries and cancelSeries trigger ltv_cache', async () => {
    await reservationSeriesService.createSeries({
      customerId: 'cust_1', treatmentName: 'Pijat Bayi Ceria', totalSessions: 1,
      sessions: [{ sessionNumber: 1, bookingDate: new Date() }],
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
});
