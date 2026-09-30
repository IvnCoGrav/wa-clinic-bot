import { describe, it, expect } from 'vitest';
import {
  ACTIVE_RESERVATION_STATUSES,
  CONFIRMED_FAMILY_STATUSES,
  EN_ROUTE_STATUS,
  isActiveReservation,
  isActiveReservationStatus,
} from '../../src/domain/reservation-status';

/**
 * Kontrak domain status reservasi — penambahan `en_route` (plan 2026-09-30,
 * NAVIGASI_DEPART_CONTROL_REVISI_PLAN Fase 1).
 *
 * `en_route` = Bidan sudah berangkat menuju lokasi pasien. Secara semantik
 * setara `confirmed` yang sedang berlangsung: menempati slot, dihitung kunjungan
 * aktif, dan dianggap kunjungan sah saat dihitung sebagai riwayat.
 */
describe('domain/reservation-status — en_route', () => {
  it('en_route termasuk jadwal aktif', () => {
    expect(ACTIVE_RESERVATION_STATUSES).toContain(EN_ROUTE_STATUS);
    expect(isActiveReservationStatus('en_route')).toBe(true);
  });

  it('en_route aktif kapan pun (tanpa syarat booking_date)', () => {
    expect(isActiveReservation({ status: 'en_route', booking_date: null })).toBe(true);
    expect(isActiveReservation({ status: 'en_route', booking_date: new Date('2020-01-01') })).toBe(true);
  });

  it('en_route setara confirmed untuk riwayat kunjungan', () => {
    expect(CONFIRMED_FAMILY_STATUSES).toContain('en_route');
    expect(CONFIRMED_FAMILY_STATUSES).toContain('confirmed');
  });

  it('status non-aktif tidak terpengaruh', () => {
    for (const s of ['completed', 'cancelled', 'rejected', 'unknown', '', null, undefined]) {
      expect(isActiveReservationStatus(s as any)).toBe(false);
      expect(isActiveReservation({ status: s as any, booking_date: new Date() })).toBe(false);
    }
  });

  it('hold tetap butuh jendela 2 jam (perilaku lama tak berubah)', () => {
    const now = Date.now();
    expect(isActiveReservation({ status: 'hold', booking_date: new Date(now - 60 * 60 * 1000) }, now)).toBe(true);
    expect(isActiveReservation({ status: 'hold', booking_date: new Date(now - 3 * 60 * 60 * 1000) }, now)).toBe(false);
  });

  it('pending & confirmed tetap aktif (regression lock)', () => {
    expect(isActiveReservationStatus('pending')).toBe(true);
    expect(isActiveReservationStatus('confirmed')).toBe(true);
  });
});
