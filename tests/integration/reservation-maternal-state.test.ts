/**
 * Fase 1 — Integrasi seam kanonis `saveReservation`.
 *
 * Kontrak:
 *  1. Semua saluran (bot/webhook/admin) menulis state maternal terstruktur.
 *  2. Parameter eksplisit menang atas teks `raw_text`.
 *  3. Booking non-Moms tidak mengisi kolom maternal (anti false-positive).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { reservationCoreService } from '../../src/services/reservation-core.service';

describe('Fase 1 — reservation-core menulis state maternal', () => {
  const tenantId = 'default-tenant';
  const customerId = 'cust-maternal-1';
  const bookingDate = new Date('2026-11-10T02:00:00Z');

  function mockHappyPath() {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.reservation, 'create').mockImplementation(async ({ data }: any) => ({
      id: 'res-maternal-1',
      ...data,
    }));
    vi.spyOn(prisma.staff, 'count').mockResolvedValue(1 as any);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('menurunkan usia kehamilan dari raw_text (label-first) saat argumen eksplisit kosong', async () => {
    mockHappyPath();
    const { reservationLifecycleService } = await import('../../src/services/reservation-lifecycle.service');
    vi.spyOn(reservationLifecycleService, 'onReservationCreated').mockResolvedValue(undefined as any);

    await reservationCoreService.saveReservation({
      tenantId,
      customerId,
      bookingDate,
      treatmentCategory: 'MOMS' as any,
      treatmentDetail: 'Kala Mom – Pregnant Massage',
      rawText: '[V3_NATIVE_AGENT_TOOL] Kala Mom – Pregnant Massage | 2026-11-10 | Bunda\nUsia Kehamilan: 38 minggu\nKondisi Ibu: Ibu Hamil',
      source: 'ADMIN_PANEL',
    });

    const createCall = vi.mocked(prisma.reservation.create).mock.calls[0][0] as any;
    expect(createCall.data.gestational_weeks).toBe(38);
    expect(createCall.data.mom_stage).toBe('PREGNANT');
    expect(createCall.data.hpl_date).toBeInstanceOf(Date);
  });

  it('argumen eksplisit menang atas teks raw_text', async () => {
    mockHappyPath();
    const { reservationLifecycleService } = await import('../../src/services/reservation-lifecycle.service');
    vi.spyOn(reservationLifecycleService, 'onReservationCreated').mockResolvedValue(undefined as any);

    await reservationCoreService.saveReservation({
      tenantId,
      customerId,
      bookingDate,
      treatmentCategory: 'MOMS' as any,
      treatmentDetail: 'Kala Mom – Pregnant Massage',
      rawText: 'Usia Kehamilan: 20 minggu',
      gestationalWeeks: 32,
      momStage: 'BREASTFEEDING',
      maternalAnchorAt: new Date('2026-11-01T00:00:00Z'),
      source: 'AGENT',
    });

    const createCall = vi.mocked(prisma.reservation.create).mock.calls[0][0] as any;
    expect(createCall.data.gestational_weeks).toBe(32);
    // Token kanonis: BREASTFEEDING (kontrak chat) → LACTATING (kontrak data).
    expect(createCall.data.mom_stage).toBe('LACTATING');
    expect((createCall.data.hpl_date as Date).toISOString().slice(0, 10)).toBe('2026-12-27');
  });

  it('booking non-Moms tidak mengisi kolom maternal', async () => {
    mockHappyPath();
    const { reservationLifecycleService } = await import('../../src/services/reservation-lifecycle.service');
    vi.spyOn(reservationLifecycleService, 'onReservationCreated').mockResolvedValue(undefined as any);

    await reservationCoreService.saveReservation({
      tenantId,
      customerId,
      bookingDate,
      treatmentCategory: 'BABY' as any,
      treatmentDetail: 'Kala Baby – Pijat Ceria',
      rawText: 'Pijat bayi 40 menit, bayi 9 bulan',
      source: 'ADMIN_PANEL',
    });

    const createCall = vi.mocked(prisma.reservation.create).mock.calls[0][0] as any;
    expect(createCall.data.gestational_weeks).toBeNull();
    expect(createCall.data.mom_stage).toBeNull();
    expect(createCall.data.hpl_date).toBeNull();
  });
});
