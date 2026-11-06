import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  reservationStatusService,
  InvalidTransitionError,
  PrematureCompletionError,
} from '../../src/services/reservation-status.service';

/**
 * Unit test murni seam kanonis status reservasi (P8/P10).
 * Menguji validasi + pemilihan koneksi transaksi tanpa menyentuh DB nyata.
 */
describe('ReservationStatusService — seam kanonis status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assertTransition: status sama bukan error (no-op yang sah)', () => {
    expect(() =>
      reservationStatusService.assertTransition({ status: 'confirmed' }, 'confirmed')
    ).not.toThrow();
  });

  it('assertTransition: hold -> confirmed legal', () => {
    expect(() =>
      reservationStatusService.assertTransition({ status: 'hold' }, 'confirmed')
    ).not.toThrow();
  });

  it('assertTransition: completed -> confirmed ilegal', () => {
    expect(() =>
      reservationStatusService.assertTransition({ status: 'completed' }, 'confirmed')
    ).toThrow(InvalidTransitionError);
  });

  it('assertTransition: completed prematur ditolak, force meloloskan', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    expect(() =>
      reservationStatusService.assertTransition(
        { status: 'confirmed', booking_date: future },
        'completed'
      )
    ).toThrow(PrematureCompletionError);

    expect(() =>
      reservationStatusService.assertTransition(
        { status: 'confirmed', booking_date: future },
        'completed',
        { force: true }
      )
    ).not.toThrow();
  });

  it('applyTransition: memakai handle transaksi yang diberikan (bukan prisma global)', async () => {
    const db = {
      reservation: {
        update: vi.fn().mockResolvedValue({ id: 'res-1', status: 'confirmed' }),
      },
    };

    const result = await reservationStatusService.applyTransition(
      { id: 'res-1', status: 'hold', assigned_staff_id: 'staff-1' },
      { to: 'confirmed', db }
    );

    expect(result.ok).toBe(true);
    expect(db.reservation.update).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled();
  });

  it('applyTransition: tanpa bidan -> STAFF_REQUIRED tanpa menulis status', async () => {
    const db = { reservation: { update: vi.fn() } };

    const result = await reservationStatusService.applyTransition(
      { id: 'res-2', status: 'confirmed', assigned_staff_id: null },
      { to: 'completed', db }
    );

    expect(result).toEqual({ ok: false, reason: 'STAFF_REQUIRED' });
    expect(db.reservation.update).not.toHaveBeenCalled();
  });

  it('applyTransition: transisi ilegal melempar sebelum update', async () => {
    const db = { reservation: { update: vi.fn() } };

    await expect(
      reservationStatusService.applyTransition(
        { id: 'res-3', status: 'completed' },
        { to: 'confirmed', db }
      )
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(db.reservation.update).not.toHaveBeenCalled();
  });
});
