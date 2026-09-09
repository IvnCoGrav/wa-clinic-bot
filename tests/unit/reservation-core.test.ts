import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { reservationCoreService, ReservationConflictError } from '../../src/services/reservation-core.service';

vi.mock('../../src/services/reservation-lifecycle.service', () => ({
  reservationLifecycleService: { onReservationCreated: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../src/services/follow-up.service', () => ({
  followUpService: { createReservationFollowUps: vi.fn().mockResolvedValue(undefined) },
}));

describe('reservation-core.service (kanonis)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const base = {
    tenantId: 'default-tenant',
    customerId: 'cust-1',
    chatId: '6281@c.us',
    treatmentCategory: 'BABY' as const,
    treatmentDetail: 'Pijat Bayi Ceria',
    source: 'ADMIN_PANEL' as const,
  };
  const slot = new Date('2026-09-09T02:30:00.000Z'); // 09:30 WIB

  it('menolak double booking pasien dengan 409 pada jalur ADMIN_PANEL', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: 'existing-1', booking_date: slot, duration_minutes: 60 } as any,
    ]);
    await expect(
      reservationCoreService.saveReservation({ ...base, bookingDate: slot })
    ).rejects.toMatchObject({ code: 'DUPLICATE_BOOKING', statusCode: 409 });
  });

  it('lolos dengan force: true (override admin disengaja)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      { id: 'existing-1', booking_date: slot, duration_minutes: 60 } as any,
    ]);
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'new-1' } as any);
    const res = await reservationCoreService.saveReservation({ ...base, bookingDate: slot, force: true });
    expect(res.isNew).toBe(true);
    expect(res.reservation.id).toBe('new-1');
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('menolak STAFF_COLLISION pada jalur ADMIN_PANEL', async () => {
    vi.mocked(prisma.reservation.findMany)
      .mockResolvedValueOnce([]) // tidak ada konflik customer
      .mockResolvedValueOnce([{ id: 'staff-busy', booking_date: slot, duration_minutes: 60 } as any]);
    await expect(
      reservationCoreService.saveReservation({ ...base, bookingDate: slot, assignedStaffId: 'staff-1' })
    ).rejects.toMatchObject({ code: 'STAFF_COLLISION' });
  });

  it('idempotent upsert pada jalur WEBHOOK (update, bukan row ganda)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: 'existing-1', booking_date: slot, duration_minutes: 60, treatment_category: 'BABY', treatment_detail: 'lama', purchase_value: 160000, assigned_staff_id: null } as any,
    ]);
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({ id: 'existing-1' } as any);
    const res = await reservationCoreService.saveReservation({
      ...base, source: 'WEBHOOK', bookingDate: slot, treatmentDetail: 'baru',
    });
    expect(res.isUpdate).toBe(true);
    expect(res.reservation.id).toBe('existing-1');
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('auto-konsolidasi: duplikat kedua di-cancel', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: 'keep', booking_date: slot, duration_minutes: 60, treatment_category: 'BABY', purchase_value: 160000, assigned_staff_id: null } as any,
      { id: 'dup', booking_date: slot, duration_minutes: 60, treatment_category: 'BABY', purchase_value: 160000, assigned_staff_id: null } as any,
    ]);
    vi.mocked(prisma.reservation.update)
      .mockResolvedValueOnce({ id: 'keep' } as any)
      .mockResolvedValueOnce({ id: 'dup', status: 'cancelled' } as any);
    const res = await reservationCoreService.saveReservation({ ...base, source: 'BOT', bookingDate: slot });
    expect(res.consolidatedCount).toBe(1);
    expect(prisma.reservation.update).toHaveBeenCalledWith({ where: { id: 'dup' }, data: { status: 'cancelled' } });
  });

  it('ReservationConflictError membawa payload existingReservation', () => {
    const err = new ReservationConflictError('DUPLICATE_BOOKING', { id: 'x' });
    expect(err.statusCode).toBe(409);
    expect(err.existingReservation).toEqual({ id: 'x' });
  });
});
