import { describe, it, expect } from 'vitest';
import {
  resolveLegOrigin,
  computeDepartureDeadline,
  predictTaskDelay,
  etaMinutesTo,
  computeItineraryDelays,
} from '../../src/domain/delay-watchdog';

describe('Delay Watchdog Domain Logic', () => {
  const staffBase = { lat: -7.249, lng: 112.72, address: 'Rumah Thabita Demak' };
  const clinicLoc = { lat: -7.348, lng: 112.751, name: 'Klinik Waru' };

  describe('resolveLegOrigin', () => {
    it('leg pertama memakai staffBase jika tersedia', () => {
      const res = resolveLegOrigin({ staffBase, clinicLocation: clinicLoc });
      expect(res).toEqual({
        lat: -7.249,
        lng: 112.72,
        originSource: 'staff_base',
        originName: 'Rumah Thabita Demak',
      });
    });

    it('leg pertama fallback ke klinik jika staffBase null / tidak valid', () => {
      const res = resolveLegOrigin({ staffBase: null, clinicLocation: clinicLoc });
      expect(res).toEqual({
        lat: -7.348,
        lng: 112.751,
        originSource: 'clinic',
        originName: 'Klinik Waru',
      });
    });

    it('leg pertama fail-open mengembalikan null jika staffBase dan clinicLocation tidak ada', () => {
      const res = resolveLegOrigin({ staffBase: null, clinicLocation: null });
      expect(res).toBeNull();
    });

    it('pasien ke-2: jika treatment 1 BELUM selesai, TIDAK memakai alamat pasien 1 (fallback ke base)', () => {
      // Misal treatment 1 jadwal 10:00, durasi 60m + buffer 15m = selesai 11:15.
      // Sekarang jam 10:45 (masih berjalan), status masih confirmed (belum completed)
      const now = new Date('2026-11-20T10:45:00+07:00');
      const previousTask = {
        lat: -7.28,
        lng: 112.74,
        patientName: 'Aisyah',
        status: 'confirmed',
        booking_date: new Date('2026-11-20T10:00:00+07:00'),
        duration_minutes: 60,
      };

      const res = resolveLegOrigin({
        staffBase,
        clinicLocation: clinicLoc,
        previousTask,
        now,
      });

      // Harus fallback ke base, jangan pakai alamat pasien 1
      expect(res?.originSource).toBe('staff_base');
      expect(res?.originName).toBe('Rumah Thabita Demak');
    });

    it('pasien ke-2: jika treatment 1 SELESAI 20 menit lalu, MEMAKAI alamat pasien 1', () => {
      // Treatment 1 selesai jam 11:15. Sekarang jam 11:35 (20 menit lalu selesai).
      const now = new Date('2026-11-20T11:35:00+07:00');
      const previousTask = {
        lat: -7.28,
        lng: 112.74,
        patientName: 'Bunda Aisyah',
        status: 'confirmed',
        booking_date: new Date('2026-11-20T10:00:00+07:00'),
        duration_minutes: 60,
      };

      const res = resolveLegOrigin({
        staffBase,
        clinicLocation: clinicLoc,
        previousTask,
        now,
      });

      expect(res).toEqual({
        lat: -7.28,
        lng: 112.74,
        originSource: 'prev_patient',
        originName: 'Bunda Aisyah',
      });
    });

    it('pasien ke-2: jika status sudah explicitly completed, MEMAKAI alamat pasien 1 selama dalam gap', () => {
      const now = new Date('2026-11-20T11:00:00+07:00');
      const previousTask = {
        lat: -7.28,
        lng: 112.74,
        patientName: 'Dewi',
        status: 'completed',
        booking_date: new Date('2026-11-20T10:00:00+07:00'),
        duration_minutes: 60,
      };

      const res = resolveLegOrigin({
        staffBase,
        clinicLocation: clinicLoc,
        previousTask,
        now,
      });

      expect(res?.originSource).toBe('prev_patient');
      expect(res?.originName).toBe('Bunda Dewi');
    });

    it('pasien ke-2: jika treatment 1 selesai 5 jam lalu (> maxPrevOriginGapHours 3 jam), KEMBALI ke base', () => {
      // Selesai jam 11:15, sekarang jam 16:15 (5 jam kemudian)
      const now = new Date('2026-11-20T16:15:00+07:00');
      const previousTask = {
        lat: -7.28,
        lng: 112.74,
        patientName: 'Dewi',
        status: 'completed',
        booking_date: new Date('2026-11-20T10:00:00+07:00'),
        duration_minutes: 60,
      };

      const res = resolveLegOrigin({
        staffBase,
        clinicLocation: clinicLoc,
        previousTask,
        now,
        maxPrevOriginGapHours: 3,
      });

      expect(res?.originSource).toBe('staff_base');
      expect(res?.originName).toBe('Rumah Thabita Demak');
    });
  });

  describe('computeDepartureDeadline', () => {
    it('menghitung departure deadline sesuai bookingDate - ETA - buffer', () => {
      const booking = new Date('2026-11-20T10:00:00Z');
      const deadline = computeDepartureDeadline(booking, 30, 5); // 35 menit sebelum 10:00
      expect(deadline?.toISOString()).toBe(new Date('2026-11-20T09:25:00Z').toISOString());
    });

    it('fail-open mengembalikan null jika bookingDate atau eta null', () => {
      expect(computeDepartureDeadline(null, 30)).toBeNull();
      expect(computeDepartureDeadline(new Date(), null)).toBeNull();
    });
  });

  describe('predictTaskDelay', () => {
    const booking = new Date('2026-11-20T10:00:00Z');

    it('jadwal null -> level none (fail-open)', () => {
      const res = predictTaskDelay({
        bookingDate: null,
        etaMinutes: 20,
      });
      expect(res.level).toBe('none');
      expect(res.delayMinutes).toBe(0);
      expect(res.missedDeparture).toBe(false);
    });

    it('lebih awal (delayMinutes <= 0) -> level none dan missedDeparture false jika belum lewat deadline', () => {
      // Sekarang jam 09:20, ETA 30 menit -> tiba 09:50 (10 menit lebih awal, delayMinutes -10)
      const now = new Date('2026-11-20T09:20:00Z');
      const res = predictTaskDelay({
        bookingDate: booking,
        etaMinutes: 30,
        now,
        toleranceMinutes: 30,
      });
      expect(res.delayMinutes).toBe(-10);
      expect(res.level).toBe('none');
      expect(res.missedDeparture).toBe(false);
    });

    it('terlambat 29 menit (< tolerance 30) -> level none namun delayMinutes 29 (potensi keterlambatan)', () => {
      // Sekarang jam 09:59, ETA 30 menit -> tiba 10:29 (delayMinutes = 29)
      const now = new Date('2026-11-20T09:59:00Z');
      const res = predictTaskDelay({
        bookingDate: booking,
        etaMinutes: 30,
        now,
        toleranceMinutes: 30,
        criticalExtraMinutes: 15,
      });
      expect(res.delayMinutes).toBe(29);
      expect(res.level).toBe('none');
      expect(res.missedDeparture).toBe(true); // deadline jam 09:30, sekarang 09:59
    });

    it('terlambat 30 menit (>= tolerance 30) -> level warning', () => {
      // Sekarang jam 10:00, ETA 30 menit -> tiba 10:30 (delayMinutes = 30)
      const now = new Date('2026-11-20T10:00:00Z');
      const res = predictTaskDelay({
        bookingDate: booking,
        etaMinutes: 30,
        now,
        toleranceMinutes: 30,
        criticalExtraMinutes: 15,
      });
      expect(res.delayMinutes).toBe(30);
      expect(res.level).toBe('warning');
      expect(res.missedDeparture).toBe(true);
    });

    it('terlambat 44 menit (< 45) -> level warning', () => {
      const now = new Date('2026-11-20T10:14:00Z');
      const res = predictTaskDelay({
        bookingDate: booking,
        etaMinutes: 30,
        now,
        toleranceMinutes: 30,
        criticalExtraMinutes: 15,
      });
      expect(res.delayMinutes).toBe(44);
      expect(res.level).toBe('warning');
    });

    it('terlambat 45 menit (>= tolerance 30 + extra 15) -> level critical', () => {
      const now = new Date('2026-11-20T10:15:00Z');
      const res = predictTaskDelay({
        bookingDate: booking,
        etaMinutes: 30,
        now,
        toleranceMinutes: 30,
        criticalExtraMinutes: 15,
      });
      expect(res.delayMinutes).toBe(45);
      expect(res.level).toBe('critical');
    });

    it('jika bidan sudah berangkat (hasDeparted=true) atau sudah tiba (hasArrived=true), missedDeparture tetap false', () => {
      const now = new Date('2026-11-20T10:15:00Z');
      const resDeparted = predictTaskDelay({
        bookingDate: booking,
        etaMinutes: 30,
        now,
        hasDeparted: true,
      });
      expect(resDeparted.missedDeparture).toBe(false);

      const resArrived = predictTaskDelay({
        bookingDate: booking,
        etaMinutes: 30,
        now,
        hasArrived: true,
      });
      expect(resArrived.missedDeparture).toBe(false);
    });
  });

  describe('etaMinutesTo', () => {
    it('menghitung ETA menggunakan rumus kanonis calculateTripProgress', () => {
      const origin = { lat: -7.25, lng: 112.75 };
      const dest = { lat: -7.3, lng: 112.75 };
      const res = etaMinutesTo(origin, dest);
      expect(res).not.toBeNull();
      expect(typeof res?.remainingKm).toBe('number');
      expect(typeof res?.etaMinutes).toBe('number');
      expect(res!.remainingKm).toBeGreaterThan(0);
      expect(res!.etaMinutes).toBeGreaterThan(0);
    });

    it('mengembalikan null bila salah satu koordinat null', () => {
      expect(etaMinutesTo(null, { lat: -7.3, lng: 112.75 })).toBeNull();
      expect(etaMinutesTo({ lat: -7.25, lng: 112.75 }, null)).toBeNull();
    });
  });

  describe('computeItineraryDelays (seam tunggal)', () => {
    it('menghitung dua bidan secara terpisah tanpa saling meminjam origin', () => {
      const now = new Date('2026-11-20T03:00:00.000Z'); // 10:00 WIB
      const out = computeItineraryDelays({
        now,
        clinicLocation: clinicLoc,
        toleranceMinutes: 30,
        criticalExtraMinutes: 15,
        tasks: [
          {
            id: 'a1',
            staffId: 'staff-a',
            staffBase,
            customerLat: -7.25,
            customerLng: 112.75,
            bookingDate: new Date('2026-11-20T01:00:00.000Z'), // 08:00 WIB
            durationMinutes: 60,
          },
          {
            id: 'b1',
            staffId: 'staff-b',
            staffBase: { lat: -7.35, lng: 112.75, address: 'Rumah B' },
            customerLat: -7.36,
            customerLng: 112.76,
            bookingDate: new Date('2026-11-20T04:00:00.000Z'),
          },
          {
            id: 'a2',
            staffId: 'staff-a',
            staffBase,
            customerLat: -7.26,
            customerLng: 112.76,
            bookingDate: new Date('2026-11-20T03:30:00.000Z'), // 10:30 WIB
            durationMinutes: 60,
          },
        ],
      });

      expect(out.size).toBe(3);
      expect(out.get('a1')?.originSource).toBe('staff_base');
      expect(out.get('b1')?.originSource).toBe('staff_base');
      expect(out.get('a2')?.originSource).toBe('prev_patient');
    });

    it('melewati alert untuk pasien ke-2 saat treatment 1 belum selesai (origin base)', () => {
      const now = new Date('2026-11-20T04:10:00.000Z'); // 11:10 WIB
      const out = computeItineraryDelays({
        now,
        clinicLocation: clinicLoc,
        tasks: [
          {
            id: 'a1',
            staffId: 'staff-a',
            staffBase,
            customerLat: -7.25,
            customerLng: 112.75,
            bookingDate: new Date('2026-11-20T03:30:00.000Z'), // 10:30, durasi 60 → selesai 11:45
            durationMinutes: 60,
          },
          {
            id: 'a2',
            staffId: 'staff-a',
            staffBase,
            customerLat: -7.26,
            customerLng: 112.76,
            bookingDate: new Date('2026-11-20T04:00:00.000Z'), // 11:00
            durationMinutes: 60,
          },
        ],
      });

      expect(out.get('a2')?.originSource).toBe('staff_base');
      expect(out.get('a2')?.missedDeparture).toBe(true);
    });
  });
});
