import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { reservationCoreService } from '../../src/services/reservation-core.service';

vi.mock('../../src/services/reservation-lifecycle.service', () => ({
  reservationLifecycleService: { onReservationCreated: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../src/services/follow-up.service', () => ({
  followUpService: { createReservationFollowUps: vi.fn().mockResolvedValue(undefined) },
}));

/**
 * Stage 7 (R6) — idempotency request_id.
 * Bila request_id sudah ada untuk tenant → kembalikan baris itu, DILARANG
 * membuat baris baru (retry webhook / concurrency aman).
 */
describe('Reservation idempotency request_id (Stage 7 / R6)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const base = {
    tenantId: 'default-tenant',
    customerId: 'cust-req-1',
    chatId: '628111@c.us',
    treatmentCategory: 'BABY' as const,
    treatmentDetail: 'Pijat Bayi Ceria Newborn',
    source: 'AGENT' as const,
    bookingDate: new Date('2026-09-20T03:00:00.000Z'),
    requestId: 'default-tenant:cust-req-1:2026-09-20:Pijat Bayi Ceria Newborn',
  };

  it('request_id sudah ada → kembalikan existing, tidak create baru', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'existing-req', tenant_id: 'default-tenant', request_id: base.requestId,
      status: 'confirmed', booking_date: base.bookingDate, treatment_detail: 'Pijat Bayi Ceria Newborn',
    } as any);

    const res = await reservationCoreService.saveReservation(base);

    expect(res.isNew).toBe(false);
    expect(res.reservation.id).toBe('existing-req');
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('request_id belum ada → buat baru dengan request_id tersimpan', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null as any);
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'new-req', request_id: base.requestId } as any);

    const res = await reservationCoreService.saveReservation({ ...base, bookingDate: null, requestId: undefined });

    // Tanpa bookingDate + tanpa idempotent hit → buat baru
    expect(res.isNew).toBe(true);
    expect(prisma.reservation.create).toHaveBeenCalled();
    const createArg = vi.mocked(prisma.reservation.create).mock.calls[0][0] as any;
    expect(createArg.data.request_id).toBeNull();
  });

  it('CG-05 (flag): AGENT non-same-day confirmed → needs_staff_verification=true', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null as any);
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'new-verify' } as any);

    await reservationCoreService.saveReservation({ ...base, bookingDate: null, requestId: undefined });

    const createArg = vi.mocked(prisma.reservation.create).mock.calls[0][0] as any;
    expect(createArg.data.needs_staff_verification).toBe(true);
  });

  it('CG-05 (flag): ADMIN_PANEL → needs_staff_verification=false', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null as any);
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'admin-new' } as any);

    await reservationCoreService.saveReservation({ ...base, source: 'ADMIN_PANEL', bookingDate: null, requestId: undefined });

    const createArg = vi.mocked(prisma.reservation.create).mock.calls[0][0] as any;
    expect(createArg.data.needs_staff_verification).toBe(false);
  });
});
