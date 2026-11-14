import { describe, it, expect } from 'vitest';
import {
  isActiveBookingStatus,
  isCustomerConflictCandidate,
} from '../../packages/admin-dashboard/src/utils/reservationConflicts';

describe('reservationConflicts — completed bukan jadwal aktif (KNOWN #342)', () => {
  it('completed/rejected/cancelled TIDAK dihitung aktif', () => {
    expect(isActiveBookingStatus('completed')).toBe(false);
    expect(isActiveBookingStatus('cancelled')).toBe(false);
    expect(isActiveBookingStatus('rejected')).toBe(false);
    expect(isActiveBookingStatus(null)).toBe(false);
  });

  it('status aktif dikenali (case-insensitive)', () => {
    for (const s of ['confirmed', 'CONFIRMED', 'en_route', 'hold', 'pending']) {
      expect(isActiveBookingStatus(s)).toBe(true);
    }
  });

  it('kandidat konflik mengecualikan reservasi yang sedang diedit', () => {
    expect(
      isCustomerConflictCandidate({ status: 'confirmed', reservationId: 'r1', excludeReservationId: 'r1' })
    ).toBe(false);
    expect(
      isCustomerConflictCandidate({ status: 'confirmed', reservationId: 'r2', excludeReservationId: 'r1' })
    ).toBe(true);
  });

  it('riwayat completed tidak pernah menjadi kandidat konflik', () => {
    expect(isCustomerConflictCandidate({ status: 'completed', reservationId: 'r1' })).toBe(false);
  });
});
