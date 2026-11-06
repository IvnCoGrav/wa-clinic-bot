import { describe, expect, it } from 'vitest';
import {
  CustomerOwnershipReservationRow,
  resolveCustomerOwnerships,
} from '../../src/domain/staff-retention';

const row = (
  overrides: Partial<CustomerOwnershipReservationRow>
): CustomerOwnershipReservationRow => ({
  customerId: 'c1',
  status: 'completed',
  bookingDate: '2026-01-12T03:00:00.000Z',
  assignedStaffId: 's1',
  createdAt: '2026-01-12T03:00:00.000Z',
  seriesId: null,
  sessionNumber: null,
  ...overrides,
});

describe('resolveCustomerOwnerships — adversarial', () => {
  it('T1: tanpa kunjungan completed → tidak ada entry', () => {
    const result = resolveCustomerOwnerships([
      row({ status: 'pending' }),
      row({ status: 'cancelled' }),
    ]);
    expect(result.size).toBe(0);
  });

  it('T2: first-touch menang walau kunjungan terakhir beda bidan', () => {
    const result = resolveCustomerOwnerships([
      row({ bookingDate: '2026-01-12T03:00:00.000Z', assignedStaffId: 's1' }),
      row({ bookingDate: '2026-02-03T03:00:00.000Z', assignedStaffId: 's2' }),
    ]);
    const own = result.get('c1')!;
    expect(own.ownerStaffId).toBe('s1');
    expect(own.lastStaffId).toBe('s2');
    expect(own.totalVisits).toBe(2);
    expect(own.hasRotation).toBe(true);
  });

  it('T3: dua reservasi di tanggal WIB sama → 1 kunjungan, staf createdAt paling awal', () => {
    const result = resolveCustomerOwnerships([
      row({
        bookingDate: '2026-01-12T03:00:00.000Z',
        assignedStaffId: 's1',
        createdAt: '2026-01-10T00:00:00.000Z',
      }),
      row({
        bookingDate: '2026-01-12T09:00:00.000Z',
        assignedStaffId: 's2',
        createdAt: '2026-01-11T00:00:00.000Z',
      }),
    ]);
    const own = result.get('c1')!;
    expect(own.totalVisits).toBe(1);
    expect(own.ownerStaffId).toBe('s1');
  });

  it('T4: sesi series ke-2 diabaikan, sesi ke-1 dihitung', () => {
    const result = resolveCustomerOwnerships([
      row({ seriesId: 'ser-1', sessionNumber: 1, assignedStaffId: 's1' }),
      row({ seriesId: 'ser-1', sessionNumber: 2, assignedStaffId: 's2' }),
    ]);
    const own = result.get('c1')!;
    expect(own.totalVisits).toBe(1);
    expect(own.ownerStaffId).toBe('s1');
    expect(own.hasRotation).toBe(false);
  });

  it('T5: kunjungan pertama tanpa bidan → owner null, bukan menebak bidan berikutnya', () => {
    const result = resolveCustomerOwnerships([
      row({ bookingDate: '2026-01-12T03:00:00.000Z', assignedStaffId: null }),
      row({ bookingDate: '2026-02-03T03:00:00.000Z', assignedStaffId: 's2' }),
    ]);
    const own = result.get('c1')!;
    expect(own.ownerStaffId).toBeNull();
    expect(own.lastStaffId).toBe('s2');
    expect(own.hasRotation).toBe(false);
  });

  it('T6: batas WIB — 18:00 UTC tanggal 1 = 01:00 WIB tanggal 2', () => {
    const result = resolveCustomerOwnerships([
      row({ bookingDate: '2026-06-01T18:00:00.000Z', assignedStaffId: 's1' }),
    ]);
    expect(result.get('c1')!.ownerSince).toBe('2026-06-02');
  });

  it('T7: booking_date invalid tidak boleh membuat owner palsu', () => {
    const result = resolveCustomerOwnerships([
      row({ bookingDate: 'invalid-date' }),
    ]);
    expect(result.size).toBe(0);
  });

  it('T8: semua kunjungan bidan sama → hasRotation false', () => {
    const result = resolveCustomerOwnerships([
      row({ bookingDate: '2026-01-12T03:00:00.000Z', assignedStaffId: 's1' }),
      row({ bookingDate: '2026-02-03T03:00:00.000Z', assignedStaffId: 's1' }),
    ]);
    expect(result.get('c1')!.hasRotation).toBe(false);
  });

  it('T9: urutan input acak tetap deterministik', () => {
    const rows = [
      row({ bookingDate: '2026-02-03T03:00:00.000Z', assignedStaffId: 's2' }),
      row({ bookingDate: '2026-01-12T03:00:00.000Z', assignedStaffId: 's1' }),
    ];
    const a = resolveCustomerOwnerships(rows).get('c1')!;
    const b = resolveCustomerOwnerships([...rows].reverse()).get('c1')!;
    expect(a).toEqual(b);
  });

  it('T10: customer berbeda tidak saling bocor', () => {
    const result = resolveCustomerOwnerships([
      row({ customerId: 'c1', assignedStaffId: 's1' }),
      row({ customerId: 'c2', assignedStaffId: 's2' }),
    ]);
    expect(result.get('c1')!.ownerStaffId).toBe('s1');
    expect(result.get('c2')!.ownerStaffId).toBe('s2');
  });
});
