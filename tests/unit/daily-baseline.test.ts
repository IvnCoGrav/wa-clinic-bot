import { describe, it, expect } from 'vitest';
import {
  buildDailyBaseline,
  daysInMonth,
  wibDateParts,
  type BaselineReservationInput,
} from '../../src/domain/daily-baseline';
import { type AnalyticsBaselineSettings } from '../../src/config/analytics-baseline';

describe('Daily Baseline Domain (Fase 2)', () => {
  const defaultSettings: AnalyticsBaselineSettings = {
    months: 6,
    mode: 'weekday',
    smoothingWindowDays: 0,
    minMonths: 3,
  };

  it('1. Jendela lintas tahun: target Jan 2026 -> windowStart = Jul 2025, windowEnd = Des 2025', () => {
    const res = buildDailyBaseline({
      targetYear: 2026,
      targetMonth: 1,
      settings: defaultSettings,
      reservations: [],
    });

    expect(res.windowStart).toEqual({ year: 2025, month: 7 });
    expect(res.windowEnd).toEqual({ year: 2025, month: 12 });
    expect(res.previousMonth.year).toBe(2025);
    expect(res.previousMonth.month).toBe(12);
  });

  it('2. Weekday: 6 bulan data dengan Minggu Rp 1.000.000 dan Selasa Rp 200.000 -> baseline Minggu != Selasa; samples keduanya 26', () => {
    // Bangun 6 bulan data (Jul 2025 - Des 2025, target Jan 2026)
    // 26 minggu: setiap Minggu beri omset 1.000.000, setiap Selasa beri omset 200.000
    const reservations: BaselineReservationInput[] = [];

    for (let m = 7; m <= 12; m++) {
      const days = daysInMonth(2025, m);
      for (let d = 1; d <= days; d++) {
        const utcDate = new Date(Date.UTC(2025, m - 1, d, 5, 0, 0)); // jam 12:00 WIB
        const dayOfWeek = utcDate.getUTCDay();
        if (dayOfWeek === 0) {
          // Minggu
          reservations.push({ bookingDate: utcDate, revenue: 1000000, bookings: 5 });
        } else if (dayOfWeek === 2) {
          // Selasa
          reservations.push({ bookingDate: utcDate, revenue: 200000, bookings: 1 });
        }
      }
    }

    const res = buildDailyBaseline({
      targetYear: 2026,
      targetMonth: 1, // Jan 2026: tgl 4 adalah Minggu, tgl 6 adalah Selasa
      settings: defaultSettings,
      reservations,
    });

    expect(res.available).toBe(true);
    expect(res.monthsUsed).toBe(6);

    // Tanggal 4 Jan 2026 = Minggu (weekday 0)
    const sundayPoint = res.byDay.get(4);
    // Tanggal 6 Jan 2026 = Selasa (weekday 2)
    const tuesdayPoint = res.byDay.get(6);

    expect(sundayPoint?.avg6mRevenue).toBe(1000000);
    expect(tuesdayPoint?.avg6mRevenue).toBe(200000);
    expect(sundayPoint?.samples).toBe(26);
    expect(tuesdayPoint?.samples).toBe(27);
  });

  it('3. Kalender: target Nov (30 hari), riwayat berisi hari ke-31 -> tidak ada byDay.get(31)', () => {
    const reservations: BaselineReservationInput[] = [
      { bookingDate: '2026-10-31T05:00:00Z', revenue: 5000000, bookings: 10 },
      { bookingDate: '2026-08-31T05:00:00Z', revenue: 4000000, bookings: 8 },
      { bookingDate: '2026-07-31T05:00:00Z', revenue: 3000000, bookings: 6 },
    ];

    const res = buildDailyBaseline({
      targetYear: 2026,
      targetMonth: 11, // November (30 hari)
      settings: { ...defaultSettings, mode: 'calendar', smoothingWindowDays: 0 },
      reservations,
    });

    expect(res.byDay.has(31)).toBe(false);
    expect(res.byDay.size).toBe(30);
  });

  it('4. Februari kabisat 2028: daysInMonth = 29; previousMonth Jan 31 hari bila ada data', () => {
    expect(daysInMonth(2028, 2)).toBe(29);

    const resEmpty = buildDailyBaseline({
      targetYear: 2028,
      targetMonth: 2,
      settings: defaultSettings,
      reservations: [],
    });

    expect(resEmpty.byDay.size).toBe(29);
    expect(resEmpty.previousMonth.daysInMonth).toBe(31);
    // R-04: Bila bulan lalu kosong (0 reservasi), prevByDay kosong (size 0) agar grafik tidak rata 0
    expect(resEmpty.previousMonth.byDay.size).toBe(0);

    const resWithPrev = buildDailyBaseline({
      targetYear: 2028,
      targetMonth: 2,
      settings: defaultSettings,
      reservations: [{ bookingDate: '2028-01-15T05:00:00Z', revenue: 500000 }],
    });
    expect(resWithPrev.previousMonth.byDay.size).toBe(31);
    expect(resWithPrev.previousMonth.byDay.get(15)?.revenue).toBe(500000);
  });

  it('5. Bulan kosong (0 reservasi) di tengah jendela -> monthsUsed berkurang, penyebut tidak ikut, hasil tidak NaN', () => {
    const reservations: BaselineReservationInput[] = [
      // Hanya ada data di Mei, Juli, dan Oktober (Juni, Agustus, September kosong)
      { bookingDate: '2026-05-15T05:00:00Z', revenue: 1000000 },
      { bookingDate: '2026-07-15T05:00:00Z', revenue: 2000000 },
      { bookingDate: '2026-10-15T05:00:00Z', revenue: 3000000 },
    ];

    const res = buildDailyBaseline({
      targetYear: 2026,
      targetMonth: 11,
      settings: { ...defaultSettings, mode: 'calendar', smoothingWindowDays: 0, minMonths: 3 },
      reservations,
    });

    expect(res.monthsUsed).toBe(3);
    expect(res.available).toBe(true);

    const p15 = res.byDay.get(15);
    // Rata-rata tanggal 15 dari 3 bulan yang terpakai = (1jt + 2jt + 3jt) / 3 = 2.000.000
    expect(p15?.avg6mRevenue).toBe(2000000);
    expect(Number.isNaN(p15?.avg6mRevenue)).toBe(false);
  });

  it('6. monthsUsed < minMonths -> available=false, reason=INSUFFICIENT_HISTORY', () => {
    const reservations: BaselineReservationInput[] = [
      // Hanya 1 bulan yang memiliki transaksi (Oktober)
      { bookingDate: '2026-10-10T05:00:00Z', revenue: 500000 },
    ];

    const res = buildDailyBaseline({
      targetYear: 2026,
      targetMonth: 11,
      settings: { ...defaultSettings, minMonths: 3 },
      reservations,
    });

    expect(res.monthsUsed).toBe(1);
    expect(res.available).toBe(false);
    expect(res.reason).toBe('INSUFFICIENT_HISTORY');
    // Nilai tetap dihitung untuk kebutuhan preview UI
    expect(res.byDay.size).toBe(30);
  });

  it('7. MA mode kalender: satu lonjakan Rp 10.000.000 di tanggal 15 -> avg6mRevenue(15) < 10.000.000 dan avg6mRevenue(15) > avg6mRevenue(12)', () => {
    // 6 bulan data flat 1.000.000 setiap hari, kecuali tanggal 15 yang melonjak 10.000.000 di satu bulan
    const reservations: BaselineReservationInput[] = [];
    for (let m = 5; m <= 10; m++) {
      for (let d = 1; d <= 30; d++) {
        const rev = m === 10 && d === 15 ? 10000000 : 1000000;
        const utcDate = new Date(Date.UTC(2026, m - 1, d, 5, 0, 0));
        reservations.push({ bookingDate: utcDate, revenue: rev });
      }
    }

    const res = buildDailyBaseline({
      targetYear: 2026,
      targetMonth: 11,
      settings: { ...defaultSettings, mode: 'calendar', smoothingWindowDays: 7 }, // radius 3
      reservations,
    });

    const p15 = res.byDay.get(15);
    const p11 = res.byDay.get(11);

    expect(p15?.avg6mRevenue).toBeLessThan(10000000);
    expect(p15?.avg6mRevenue).toBeGreaterThan(p11?.avg6mRevenue as number);
    // Peak dihaluskan oleh 7-day moving average!
    expect(p15?.avg6mRevenue).toBeLessThan(3500000);
  });

  it('8. WIB: reservasi 2026-11-01T17:30:00Z (= 2 Nov 00:30 WIB) masuk tanggal 2, bukan 1', () => {
    const parts = wibDateParts('2026-11-01T17:30:00Z');
    expect(parts?.year).toBe(2026);
    expect(parts?.month).toBe(11);
    expect(parts?.date).toBe(2);
  });

  it('9. prevMonth.byDay.get(31) undefined untuk bulan lalu yang hanya 30 hari', () => {
    // Target Desember 2026 -> bulan lalu adalah November 2026 (30 hari)
    const res = buildDailyBaseline({
      targetYear: 2026,
      targetMonth: 12,
      settings: defaultSettings,
      reservations: [{ bookingDate: '2026-11-10T05:00:00Z', revenue: 500000 }],
    });

    expect(res.previousMonth.month).toBe(11);
    expect(res.previousMonth.daysInMonth).toBe(30);
    expect(res.previousMonth.byDay.get(30)).toBeDefined();
    expect(res.previousMonth.byDay.get(31)).toBeUndefined();
  });

  it('10. Target tanpa data sama sekali -> semua null/empty, tidak throw', () => {
    const res = buildDailyBaseline({
      targetYear: 2026,
      targetMonth: 11,
      settings: defaultSettings,
      reservations: [],
    });

    expect(res.available).toBe(false);
    expect(res.reason).toBe('NO_HISTORY');
    expect(res.monthsUsed).toBe(0);
    expect(res.byDay.size).toBe(30);

    for (const point of res.byDay.values()) {
      expect(point.avg6mRevenue).toBeNull();
      expect(point.avg6mBookings).toBeNull();
      expect(point.samples).toBe(0);
    }
  });
});
