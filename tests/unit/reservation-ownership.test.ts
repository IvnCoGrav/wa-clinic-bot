import { describe, it, expect } from 'vitest';
import {
  resolveReservationOwnerId,
  isReservationOwnedBy,
  filterOwnedReservations,
  pickOwnedActiveReservations,
} from '../../packages/admin-dashboard/src/utils/reservationOwnership';

const NOW = new Date('2026-11-18T03:00:00.000Z'); // 10:00 WIB
const today0900 = '2026-11-18T02:00:00.000Z';
const yesterday = '2026-11-17T09:00:00.000Z';
const tomorrow = '2026-11-19T09:00:00.000Z';

describe('reservationOwnership — invarian kepemilikan', () => {
  it('menolak reservasi milik customer lain (kasus 18 Nov: chat amels vs reservasi Bunda Gita)', () => {
    const r = { id: 'r1', customer_id: 'cust-gita', status: 'confirmed', booking_date: today0900 };
    expect(isReservationOwnedBy(r, 'cust-amels')).toBe(false);
    expect(pickOwnedActiveReservations([r], 'cust-amels', NOW).activeConfirmed).toBeNull();
    expect(pickOwnedActiveReservations([r], 'cust-amels', NOW).hasUpcomingBooking).toBe(false);
  });

  it('fail-closed bila owner tidak diketahui', () => {
    expect(isReservationOwnedBy({ id: 'x', status: 'confirmed', booking_date: today0900 }, 'cust-a')).toBe(false);
    expect(filterOwnedReservations([{ id: 'x' }], 'cust-a')).toEqual([]);
    expect(resolveReservationOwnerId(null)).toBeNull();
    expect(resolveReservationOwnerId(undefined)).toBeNull();
    expect(resolveReservationOwnerId({})).toBeNull();
    expect(resolveReservationOwnerId('string-bukan-objek')).toBeNull();
  });

  it('menerima owner dari customer_id / customerId / customer.id', () => {
    expect(isReservationOwnedBy({ customer_id: 'a' }, 'a')).toBe(true);
    expect(isReservationOwnedBy({ customerId: 'a' }, 'a')).toBe(true);
    expect(isReservationOwnedBy({ customer: { id: 'a' } }, 'a')).toBe(true);
    expect(resolveReservationOwnerId({ customer_id: 'cust-1' })).toBe('cust-1');
    expect(resolveReservationOwnerId({ customerId: 'cust-2' })).toBe('cust-2');
    expect(resolveReservationOwnerId({ customer: { id: 'cust-3' } })).toBe('cust-3');
  });

  it('hold basi >2 jam dibuang; hold masih berlaku dipakai', () => {
    // NOW = 10:00 WIB (03:00 UTC).
    // Toleransi 2 jam: booking_date >= NOW - 2 jam (01:00 UTC) masih valid.
    const staleHold = {
      id: 'h-stale',
      customer_id: 'cust-a',
      status: 'hold',
      booking_date: '2026-11-18T00:30:00.000Z', // 2.5 jam lalu -> basi
    };
    const validHold = {
      id: 'h-valid',
      customer_id: 'cust-a',
      status: 'hold',
      booking_date: '2026-11-18T02:00:00.000Z', // 1 jam lalu -> masih berlaku
    };

    const resStale = pickOwnedActiveReservations([staleHold], 'cust-a', NOW);
    expect(resStale.activeHold).toBeNull();
    expect(resStale.hasActiveHold).toBe(false);

    const resValid = pickOwnedActiveReservations([validHold], 'cust-a', NOW);
    expect(resValid.activeHold).toEqual(validHold);
    expect(resValid.hasActiveHold).toBe(true);
  });

  it('confirmed kemarin dibuang, hari ini/depan dipakai; en_route dihitung confirmed', () => {
    const yesterdayBooking = {
      id: 'b-yesterday',
      customer_id: 'cust-a',
      status: 'confirmed',
      booking_date: yesterday,
    };
    const todayBooking = {
      id: 'b-today',
      customer_id: 'cust-a',
      status: 'confirmed',
      booking_date: today0900,
    };
    const tomorrowBooking = {
      id: 'b-tomorrow',
      customer_id: 'cust-a',
      status: 'confirmed',
      booking_date: tomorrow,
    };
    const enRouteBooking = {
      id: 'b-otw',
      customer_id: 'cust-a',
      status: 'en_route',
      booking_date: today0900,
    };

    expect(pickOwnedActiveReservations([yesterdayBooking], 'cust-a', NOW).activeConfirmed).toBeNull();
    expect(pickOwnedActiveReservations([todayBooking], 'cust-a', NOW).activeConfirmed).toEqual(todayBooking);
    expect(pickOwnedActiveReservations([tomorrowBooking], 'cust-a', NOW).activeConfirmed).toEqual(tomorrowBooking);
    expect(pickOwnedActiveReservations([enRouteBooking], 'cust-a', NOW).activeConfirmed).toEqual(enRouteBooking);
    expect(pickOwnedActiveReservations([enRouteBooking], 'cust-a', NOW).hasUpcomingBooking).toBe(true);
  });

  it('reservasi milik customer lain tidak pernah mengisi pending/hold/confirmed', () => {
    const otherReservations = [
      { id: 'r-other-1', customer_id: 'cust-other', status: 'pending', booking_date: today0900 },
      { id: 'r-other-2', customer_id: 'cust-other', status: 'hold', booking_date: today0900 },
      { id: 'r-other-3', customer_id: 'cust-other', status: 'confirmed', booking_date: today0900 },
      { id: 'r-other-4', customer_id: 'cust-other', status: 'en_route', booking_date: today0900 },
    ];

    const result = pickOwnedActiveReservations(otherReservations, 'cust-target', NOW);
    expect(result.activeHold).toBeNull();
    expect(result.activeConfirmed).toBeNull();
    expect(result.activePending).toBeNull();
    expect(result.hasActiveHold).toBe(false);
    expect(result.hasUpcomingBooking).toBe(false);
    expect(result.hasPendingBooking).toBe(false);
  });

  it('input kosong/undefined/non-array tidak melempar error', () => {
    expect(pickOwnedActiveReservations(undefined, 'cust-a', NOW).hasUpcomingBooking).toBe(false);
    expect(pickOwnedActiveReservations(null, 'cust-a', NOW).hasUpcomingBooking).toBe(false);
    expect(pickOwnedActiveReservations('bukan array' as any, 'cust-a', NOW).hasUpcomingBooking).toBe(false);
    expect(filterOwnedReservations('bukan array' as any, 'cust-a')).toEqual([]);
    expect(filterOwnedReservations(null, 'cust-a')).toEqual([]);
    expect(filterOwnedReservations(undefined, 'cust-a')).toEqual([]);
    expect(filterOwnedReservations([], 'cust-a')).toEqual([]);
    expect(filterOwnedReservations([{ id: '1', customer_id: 'cust-a' }], null)).toEqual([]);
    expect(filterOwnedReservations([{ id: '1', customer_id: 'cust-a' }], undefined)).toEqual([]);
  });
});
