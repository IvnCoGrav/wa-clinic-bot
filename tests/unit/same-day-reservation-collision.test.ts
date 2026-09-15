import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { reservationCoreService, ReservationConflictError } from '../../src/services/reservation-core.service';

vi.mock('../../src/services/reservation-lifecycle.service', () => ({
  reservationLifecycleService: { onReservationCreated: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../src/services/follow-up.service', () => ({
  followUpService: { createReservationFollowUps: vi.fn().mockResolvedValue(undefined) },
}));

describe('Same-Day Reservation Collision Guard (sesi Bunda Lutfia #6282229353440)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const base = {
    tenantId: 'default-tenant',
    customerId: 'f862cad2-cd20-42cb-8eff-9cc43d8e4c79',
    chatId: '6282229353440@c.us',
    treatmentCategory: 'BABY' as const,
    treatmentDetail: 'Pijat Bayi Ceria Newborn',
    source: 'BOT' as const,
  };
  const slotMorning = new Date('2026-09-15T02:00:00.000Z'); // 09:00 WIB
  const slotLate = new Date('2026-09-15T04:00:00.000Z');    // 11:00 WIB
  const otherDay = new Date('2026-09-16T04:00:00.000Z');    // 11:00 WIB 16 Sep (hari lain)

  // --- Adversarial Test 1 (Bunda Lutfia): form tanpa jam → duplikat hari sama
  it('BOT/WEBHOOK: customer sama + hari kalender sama (09:00 vs 11:00) → update idempotent, TIDAK buat row baru', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: '84cd065e-3808-402d-8e9f-3d062a2f9dfe', booking_date: slotMorning, duration_minutes: 60, treatment_category: 'BABY', treatment_detail: 'Pijat Rileksasi', purchase_value: 60000, assigned_staff_id: null, status: 'confirmed' } as any,
    ]);
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({ id: '84cd065e-3808-402d-8e9f-3d062a2f9dfe', status: 'confirmed' } as any);
    const res = await reservationCoreService.saveReservation({
      ...base, source: 'WEBHOOK', bookingDate: slotLate, treatmentDetail: 'Pijat Bayi Ceria Newborn [Total 60m]', purchaseValue: 60000, assignedStaffId: 'f88cedf5-3756-4f24-bb77-45050c029979',
    });
    expect(res.isNew).toBe(false);
    expect(res.isUpdate).toBe(true);
    expect(res.reservation.id).toBe('84cd065e-3808-402d-8e9f-3d062a2f9dfe');
    expect(res.consolidatedCount).toBe(0);
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  // --- Adversarial Test 2 (Admin Force Override)
  it('ADMIN_PANEL force:true membuat baris baru meski same-day active (override disengaja)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: 'existing', booking_date: slotMorning, duration_minutes: 60, treatment_category: 'BABY', treatment_detail: 'Pijat Rileksasi', purchase_value: 60000, assigned_staff_id: null, status: 'confirmed' } as any,
    ]);
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'forced-new' } as any);
    const res = await reservationCoreService.saveReservation({
      ...base, source: 'ADMIN_PANEL', force: true, bookingDate: slotLate, treatmentDetail: 'Pijat Bayi Ceria Newborn', purchaseValue: 60000,
    });
    expect(res.isNew).toBe(true);
    expect(res.reservation.id).toBe('forced-new');
  });

  // --- Adversarial Test 3 (Exact Overlap): admin tanpa force → 409
  it('ADMIN_PANEL tanpa force + same-day active → lempar DUPLICATE_BOOKING', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: '84cd065e-3808-402d-8e9f-3d062a2f9dfe', booking_date: slotMorning, duration_minutes: 60, treatment_category: 'BABY', treatment_detail: 'Pijat Rileksasi', purchase_value: 60000, assigned_staff_id: null, status: 'confirmed' } as any,
    ]);
    await expect(
      reservationCoreService.saveReservation({ ...base, source: 'ADMIN_PANEL', bookingDate: slotLate, treatmentDetail: 'Pijat Bayi Ceria Newborn' })
    ).rejects.toMatchObject({ code: 'DUPLICATE_BOOKING', statusCode: 409 });
  });

  // --- Adversarial Test 4 (Multi-session series): hari BERBEDA → tidak terblokir
  it('customer sama + hari kalender BERBEDA → buatkan baris baru (series 14-hari aman)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'series-new' } as any);
    const res = await reservationCoreService.saveReservation({
      ...base, source: 'WEBHOOK', bookingDate: otherDay, treatmentDetail: 'Pijat Bayi Ceria Newborn', purchaseValue: 60000,
    });
    expect(res.isNew).toBe(true);
    expect(res.reservation.id).toBe('series-new');
  });

  // --- Adversarial Test 5: BOT/AGENT mode juga merge same-day (bukan hanya WEBHOOK)
  it('BOT dan AGENT: same-day active → merge ke primary, duplikat di-cancel', async () => {
    for (const src of ['BOT', 'AGENT'] as const) {
      vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
        { id: 'primary', booking_date: slotMorning, duration_minutes: 60, treatment_category: 'BABY', treatment_detail: 'Pijat Rileksasi', purchase_value: 60000, assigned_staff_id: null, status: 'confirmed' } as any,
        { id: 'dup', booking_date: slotLate, duration_minutes: 60, treatment_category: 'BABY', treatment_detail: 'Pijat Bayi Ceria Newborn', purchase_value: 60000, assigned_staff_id: null, status: 'confirmed' } as any,
      ]);
      vi.mocked(prisma.reservation.update)
        .mockResolvedValueOnce({ id: 'primary', status: 'confirmed' } as any)
        .mockResolvedValueOnce({ id: 'dup', status: 'cancelled' } as any);
      const res = await reservationCoreService.saveReservation({ ...base, source: src, bookingDate: slotLate, treatmentDetail: 'Pijat Bayi Ceria Newborn' });
      expect(res.isNew).toBe(false);
      expect(res.reservation.id).toBe('primary');
      expect(res.consolidatedCount).toBe(1);
    }
  });
});
