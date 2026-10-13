import { describe, it, expect } from 'vitest';
import {
  isFriendlyHoursWib,
  isPreciseGpsLike,
  computeSharelocSignal,
  SharelocSignalInput,
} from '../../src/services/shareloc-signal.service';
import { WIB_OFFSET_MS } from '../../src/utils/wib-time';

describe('Shareloc Signal Service — Pure Evaluator & Adversarial Tests', () => {
  describe('isFriendlyHoursWib', () => {
    it('mengembalikan false untuk jam di luar 08:00 - 20:00 WIB', () => {
      // 07:59:59 WIB = 00:59:59 UTC
      const t0759 = new Date(Date.UTC(2026, 9, 13, 0, 59, 59));
      expect(isFriendlyHoursWib(t0759)).toBe(false);

      // 20:00:00 WIB = 13:00:00 UTC
      const t2000 = new Date(Date.UTC(2026, 9, 13, 13, 0, 0));
      expect(isFriendlyHoursWib(t2000)).toBe(false);

      // 23:30:00 WIB = 16:30:00 UTC
      const t2330 = new Date(Date.UTC(2026, 9, 13, 16, 30, 0));
      expect(isFriendlyHoursWib(t2330)).toBe(false);

      // 03:00:00 WIB = 20:00:00 UTC (kemarin)
      const t0300 = new Date(Date.UTC(2026, 9, 12, 20, 0, 0));
      expect(isFriendlyHoursWib(t0300)).toBe(false);
    });

    it('mengembalikan true untuk jam 08:00 sampai 19:59 WIB', () => {
      // 08:00:00 WIB = 01:00:00 UTC
      const t0800 = new Date(Date.UTC(2026, 9, 13, 1, 0, 0));
      expect(isFriendlyHoursWib(t0800)).toBe(true);

      // 12:30:00 WIB = 05:30:00 UTC
      const t1230 = new Date(Date.UTC(2026, 9, 13, 5, 30, 0));
      expect(isFriendlyHoursWib(t1230)).toBe(true);

      // 19:59:59 WIB = 12:59:59 UTC
      const t1959 = new Date(Date.UTC(2026, 9, 13, 12, 59, 59));
      expect(isFriendlyHoursWib(t1959)).toBe(true);
    });
  });

  describe('isPreciseGpsLike', () => {
    it('menganggap presisi bila locationSource adalah salah satu tipe pin presisi', () => {
      const sources = ['gps_pin', 'GPS_PIN', 'bidan_shareloc', 'customer_shareloc', 'url_coords'];
      for (const s of sources) {
        expect(
          isPreciseGpsLike({
            locationSource: s,
            shareLocationSent: false,
            lat: null,
            lng: null,
            reservationStatus: 'confirmed',
            reservationBookingDate: null,
            reservationCreatedAt: null,
            sharelocRequestedAt: null,
          })
        ).toBe(true);
      }
    });

    it('menganggap presisi bila shareLocationSent=true dan lat/lng terisi valid', () => {
      expect(
        isPreciseGpsLike({
          locationSource: 'estimated_area',
          shareLocationSent: true,
          lat: -7.31234,
          lng: 112.7891,
          reservationStatus: 'confirmed',
          reservationBookingDate: null,
          reservationCreatedAt: null,
          sharelocRequestedAt: null,
        })
      ).toBe(true);
    });

    it('tidak menganggap presisi bila estimated_area tanpa shareLocationSent valid', () => {
      expect(
        isPreciseGpsLike({
          locationSource: 'estimated_area',
          shareLocationSent: false,
          lat: -7.3,
          lng: 112.7,
          reservationStatus: 'confirmed',
          reservationBookingDate: null,
          reservationCreatedAt: null,
          sharelocRequestedAt: null,
        })
      ).toBe(false);
    });
  });

  describe('computeSharelocSignal', () => {
    const fixedNow = new Date('2026-10-13T10:00:00+07:00'); // 10:00 WIB

    it('mengembalikan needed=false jika tidak ada reservasi aktif atau status tidak aktif', () => {
      const resNone = computeSharelocSignal({
        locationSource: 'estimated_area',
        shareLocationSent: false,
        lat: null,
        lng: null,
        reservationStatus: null,
        reservationBookingDate: null,
        reservationCreatedAt: null,
        sharelocRequestedAt: null,
        now: fixedNow,
      });
      expect(resNone.needed).toBe(false);
      expect(resNone.reason).toBe('no_reservation');

      const resCancelled = computeSharelocSignal({
        locationSource: 'estimated_area',
        shareLocationSent: false,
        lat: null,
        lng: null,
        reservationStatus: 'cancelled',
        reservationBookingDate: '2026-10-13T14:00:00+07:00',
        reservationCreatedAt: '2026-10-13T09:00:00+07:00',
        sharelocRequestedAt: null,
        now: fixedNow,
      });
      expect(resCancelled.needed).toBe(false);
      expect(resCancelled.reason).toBe('status_not_active');
    });

    it('mengembalikan needed=false jika hold sudah kedaluwarsa (> 2 jam lewat)', () => {
      // Booking date 3 jam yang lalu dari fixedNow
      const expiredBooking = new Date(fixedNow.getTime() - 3 * 3600 * 1000);
      const res = computeSharelocSignal({
        locationSource: 'estimated_area',
        shareLocationSent: false,
        lat: null,
        lng: null,
        reservationStatus: 'hold',
        reservationBookingDate: expiredBooking,
        reservationCreatedAt: new Date(fixedNow.getTime() - 4 * 3600 * 1000),
        sharelocRequestedAt: null,
        now: fixedNow,
      });
      expect(res.needed).toBe(false);
      expect(res.reason).toBe('hold_expired');
    });

    it('mengembalikan needed=false jika confirmed sudah di luar jendela aktif (> 2 jam lewat)', () => {
      const expiredBooking = new Date(fixedNow.getTime() - 3 * 3600 * 1000);
      const res = computeSharelocSignal({
        locationSource: 'estimated_area',
        shareLocationSent: false,
        lat: null,
        lng: null,
        reservationStatus: 'confirmed',
        reservationBookingDate: expiredBooking,
        reservationCreatedAt: new Date(fixedNow.getTime() - 5 * 3600 * 1000),
        sharelocRequestedAt: null,
        now: fixedNow,
      });
      expect(res.needed).toBe(false);
      expect(res.reason).toBe('outside_window');
    });

    it('mengembalikan needed=false jika koordinat sudah presisi (already_precise)', () => {
      const res = computeSharelocSignal({
        locationSource: 'gps_pin',
        shareLocationSent: true,
        lat: -7.31,
        lng: 112.78,
        reservationStatus: 'confirmed',
        reservationBookingDate: '2026-10-13T14:00:00+07:00',
        reservationCreatedAt: new Date(fixedNow.getTime() - 1 * 3600 * 1000),
        sharelocRequestedAt: null,
        now: fixedNow,
      });
      expect(res.needed).toBe(false);
      expect(res.reason).toBe('already_precise');
    });

    it('menghormati cooldown 6 jam setelah sharelocRequestedAt', () => {
      // Diminta 5 jam lalu -> cooldown aktif (<6 jam)
      const requested5h = new Date(fixedNow.getTime() - 5 * 3600 * 1000);
      const res5h = computeSharelocSignal({
        locationSource: 'estimated_area',
        shareLocationSent: false,
        lat: null,
        lng: null,
        reservationStatus: 'confirmed',
        reservationBookingDate: '2026-10-13T16:00:00+07:00',
        reservationCreatedAt: new Date(fixedNow.getTime() - 6 * 3600 * 1000),
        sharelocRequestedAt: requested5h,
        now: fixedNow,
      });
      expect(res5h.needed).toBe(false);
      expect(res5h.reason).toBe('cooldown_6h');

      // Diminta 7 jam lalu -> cooldown lewat (>=6 jam) -> needed kembali true
      const requested7h = new Date(fixedNow.getTime() - 7 * 3600 * 1000);
      const res7h = computeSharelocSignal({
        locationSource: 'estimated_area',
        shareLocationSent: false,
        lat: null,
        lng: null,
        reservationStatus: 'confirmed',
        reservationBookingDate: '2026-10-13T16:00:00+07:00',
        reservationCreatedAt: new Date(fixedNow.getTime() - 8 * 3600 * 1000),
        sharelocRequestedAt: requested7h,
        now: fixedNow,
      });
      expect(res7h.needed).toBe(true);
    });

    it('same-day booking langsung needed=true dan urgent=true (kartu instan)', () => {
      // Booking hari ini jam 15:00 WIB, baru dibuat 10 menit lalu
      const res = computeSharelocSignal({
        locationSource: 'estimated_area',
        shareLocationSent: false,
        lat: null,
        lng: null,
        reservationStatus: 'confirmed',
        reservationBookingDate: '2026-10-13T15:00:00+07:00',
        reservationCreatedAt: new Date(fixedNow.getTime() - 10 * 60 * 1000),
        sharelocRequestedAt: null,
        now: fixedNow,
      });
      expect(res.needed).toBe(true);
      expect(res.urgent).toBe(true);
      expect(res.reason).toBe('same_day');
    });

    it('advance booking (H+2) menunggu 3 jam setelah reservasi dibuat', () => {
      // Booking 2 hari ke depan (15 Okt), dibuat 1 jam lalu -> belum 3 jam
      const resWait = computeSharelocSignal({
        locationSource: 'estimated_area',
        shareLocationSent: false,
        lat: null,
        lng: null,
        reservationStatus: 'confirmed',
        reservationBookingDate: '2026-10-15T10:00:00+07:00',
        reservationCreatedAt: new Date(fixedNow.getTime() - 1 * 3600 * 1000),
        sharelocRequestedAt: null,
        now: fixedNow,
      });
      expect(resWait.needed).toBe(false);
      expect(resWait.reason).toBe('advance_wait_3h');

      // Booking 2 hari ke depan (15 Okt), dibuat 4 jam lalu -> >= 3 jam -> needed non-urgent
      const resDue = computeSharelocSignal({
        locationSource: 'estimated_area',
        shareLocationSent: false,
        lat: null,
        lng: null,
        reservationStatus: 'confirmed',
        reservationBookingDate: '2026-10-15T10:00:00+07:00',
        reservationCreatedAt: new Date(fixedNow.getTime() - 4 * 3600 * 1000),
        sharelocRequestedAt: null,
        now: fixedNow,
      });
      expect(resDue.needed).toBe(true);
      expect(resDue.urgent).toBe(false);
      expect(resDue.reason).toBe('advance_due');
    });

    it('status en_route dianggap sah sebagai keluarga confirmed dan memicu needed=true', () => {
      const res = computeSharelocSignal({
        locationSource: 'estimated_area',
        shareLocationSent: false,
        lat: null,
        lng: null,
        reservationStatus: 'en_route',
        reservationBookingDate: '2026-10-13T11:00:00+07:00',
        reservationCreatedAt: new Date(fixedNow.getTime() - 30 * 60 * 1000),
        sharelocRequestedAt: null,
        now: fixedNow,
      });
      expect(res.needed).toBe(true);
      expect(res.urgent).toBe(true);
      expect(res.reason).toBe('same_day');
    });

    it('kebal terhadap teks obrolan (anti-regex): evaluasi murni berbasis data terstruktur', () => {
      // Bukti kebal terhadap kalimat chat apa pun: status di bawah sama persis
      const baseInput: SharelocSignalInput = {
        locationSource: 'estimated_area',
        shareLocationSent: false,
        lat: null,
        lng: null,
        reservationStatus: 'confirmed',
        reservationBookingDate: '2026-10-13T16:00:00+07:00',
        reservationCreatedAt: new Date(fixedNow.getTime() - 10 * 60 * 1000),
        sharelocRequestedAt: null,
        now: fixedNow,
      };

      const res1 = computeSharelocSignal(baseInput);
      expect(res1.needed).toBe(true);
      expect(res1.urgent).toBe(true);

      // Bila sudah dicatat sharelocRequestedAt di database (tanpa peduli kalimat apa yang diketik admin)
      const withRequested = { ...baseInput, sharelocRequestedAt: fixedNow };
      const res2 = computeSharelocSignal(withRequested);
      expect(res2.needed).toBe(false);
      expect(res2.reason).toBe('cooldown_6h');
    });
  });
});
