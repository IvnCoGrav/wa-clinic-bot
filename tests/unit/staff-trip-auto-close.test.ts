import { describe, it, expect, beforeEach } from 'vitest';
import {
  staffTripTrackingService,
  isTripScheduleExpired,
  TRIP_AUTO_CLOSE_GRACE_MS,
} from '../../src/services/staff-trip-tracking.service';

/**
 * #162e — Auto-close sesi perjalanan terapis berbasis jam jadwal.
 *
 * TTL 600s sudah mencegah memory leak, tetapi sesi trip yang "terlupa"
 * (terapis tidak menekan tombol stop) tetap dianggap aktif sampai TTL.
 * Gerbang deterministik: sesi dianggap kedaluwarsa bila jadwal kunjungan
 * + durasi + grace (1 jam) sudah lewat — sweep cron menutupnya.
 */
describe('#162e staff trip auto-close (berbasis jam jadwal)', () => {
  beforeEach(() => {
    staffTripTrackingService.clearAll();
  });

  describe('isTripScheduleExpired (murni)', () => {
    const now = new Date('2026-09-29T10:00:00.000Z'); // 17:00 WIB

    it('jadwal + durasi + grace sudah lewat → expired', () => {
      // Jadwal 08:00 WIB (01:00Z), durasi 60m → selesai 02:00Z; +1h grace = 03:00Z < now
      const booking = new Date('2026-09-29T01:00:00.000Z');
      expect(isTripScheduleExpired(booking, 60, now)).toBe(true);
    });

    it('jadwal masih berjalan (dalam durasi) → TIDAK expired', () => {
      const booking = new Date('2026-09-29T09:30:00.000Z'); // 30 mnt lalu
      expect(isTripScheduleExpired(booking, 60, now)).toBe(false);
    });

    it('jadwal sudah lewat tapi dalam jendela grace → TIDAK expired', () => {
      // booking 08:00Z, durasi 60m → 09:00Z; grace 1h → 10:00Z; now = 10:00Z (tepat)
      const booking = new Date('2026-09-29T08:00:00.000Z');
      expect(isTripScheduleExpired(booking, 60, now)).toBe(false);
      // 1 detik setelah grace → expired
      const justAfter = new Date(now.getTime() + 1000);
      expect(isTripScheduleExpired(booking, 60, justAfter)).toBe(true);
    });

    it('booking_date null/invalid → TIDAK expired (fail-open, jangan tutup buta)', () => {
      expect(isTripScheduleExpired(null, 60, now)).toBe(false);
      expect(isTripScheduleExpired(new Date('invalid'), 60, now)).toBe(false);
    });

    it('durasi null → pakai fallback 60 menit', () => {
      const booking = new Date('2026-09-29T01:00:00.000Z'); // 9 jam lalu
      expect(isTripScheduleExpired(booking, null, now)).toBe(true);
    });

    it('grace konstan 1 jam', () => {
      expect(TRIP_AUTO_CLOSE_GRACE_MS).toBe(60 * 60 * 1000);
    });
  });

  describe('listActiveTrips', () => {
    it('mengembalikan sesi aktif saja, terisolasi per-tenant', () => {
      staffTripTrackingService.recordTripPing('tenant-a', 'res-1', 'staff-1', { lat: -7.3, lng: 112.7 });
      staffTripTrackingService.recordTripPing('tenant-b', 'res-2', 'staff-2', { lat: -7.4, lng: 112.8 });

      const all = staffTripTrackingService.listActiveTrips();
      expect(all).toHaveLength(2);

      const onlyA = staffTripTrackingService.listActiveTrips('tenant-a');
      expect(onlyA).toHaveLength(1);
      expect(onlyA[0].reservationId).toBe('res-1');
    });

    it('sesi yang sudah di-clear tidak muncul', () => {
      staffTripTrackingService.recordTripPing('tenant-a', 'res-1', 'staff-1', { lat: -7.3, lng: 112.7 });
      staffTripTrackingService.clearTrip('tenant-a', 'res-1');
      expect(staffTripTrackingService.listActiveTrips()).toHaveLength(0);
    });
  });
});
