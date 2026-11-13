import { describe, it, expect } from 'vitest';
import { buildTreatmentHeatmap, type HeatmapReservationInput } from '../../src/domain/treatment-heatmap';
import { WIB_OFFSET_MS } from '../../src/utils/wib-time';

/** Bangun Date UTC absolut dari jam dinding WIB. */
function wib(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0) - WIB_OFFSET_MS);
}

function row(
  id: string,
  bookingDate: Date | string | null,
  revenue = 100_000,
  itemCount = 1
): HeatmapReservationInput {
  return { id, bookingDate, status: 'completed', revenue, itemCount };
}

const HOURS = { startHourWib: 8, endHourWib: 17 };
const NOW = wib(2026, 11, 13, 12, 0);

describe('buildTreatmentHeatmap — scope weekly (pola hari × jam)', () => {
  it('mengagregasi jumlah completed per hari-dalam-minggu dan jam WIB', () => {
    const res = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'weekly',
      hours: HOURS,
      now: NOW,
      reservations: [
        row('a', wib(2026, 11, 2, 10, 0)), // Senin 10:00
        row('b', wib(2026, 11, 2, 10, 30)), // Senin 10:30
        row('c', wib(2026, 11, 3, 14, 0)), // Selasa 14:00
      ],
    });

    expect(res.totals.count).toBe(3);
    const monday10 = res.hourly!.find((c) => c.dayIndex === 0 && c.hour === 10)!;
    const tuesday14 = res.hourly!.find((c) => c.dayIndex === 1 && c.hour === 14)!;
    expect(monday10.count).toBe(2);
    expect(monday10.revenue).toBe(200_000);
    expect(tuesday14.count).toBe(1);
    expect(res.maxCount).toBe(2);
  });

  it('menampilkan sel untuk setiap jam operasional + bucket luar jam', () => {
    const res = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'weekly',
      hours: HOURS,
      now: NOW,
      reservations: [],
    });
    // 9 jam operasional (8..16) + 1 bucket luar jam, untuk 7 hari.
    expect(res.hourSlots).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(res.hourly!.length).toBe(7 * 10);
    expect(res.hourly!.filter((c) => c.hour === -1).length).toBe(7);
  });

  it('memisahkan booking di luar jam operasional ke bucket hour -1', () => {
    const res = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'weekly',
      hours: HOURS,
      now: NOW,
      reservations: [row('early', wib(2026, 11, 2, 7, 0)), row('late', wib(2026, 11, 2, 20, 0))],
    });
    const outside = res.hourly!.filter((c) => c.hour === -1);
    expect(outside.reduce((s, c) => s + c.count, 0)).toBe(2);
    expect(res.quality.outsideHoursCount).toBe(2);
  });

  it('mengikuti jam operasional tenant yang berbeda (bukan hardcode 08–17)', () => {
    const res = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'weekly',
      hours: { startHourWib: 9, endHourWib: 15 },
      now: NOW,
      reservations: [row('a', wib(2026, 11, 2, 8, 0))],
    });
    expect(res.hourSlots).toEqual([9, 10, 11, 12, 13, 14]);
    expect(res.quality.outsideHoursCount).toBe(1);
  });
});

describe('buildTreatmentHeatmap — kualitas data', () => {
  it('menghitung jam default parser tepat 09:00:00.000 WIB', () => {
    const res = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'weekly',
      hours: HOURS,
      now: NOW,
      reservations: [
        row('default', wib(2026, 11, 2, 9, 0, 0)),
        row('explicit', wib(2026, 11, 2, 9, 0, 30)),
        row('other', wib(2026, 11, 2, 10, 0)),
      ],
    });
    expect(res.quality.defaultedHourCount).toBe(1);
  });

  it('menghitung booking tanpa tanggal/invalid sebagai missingBookingDate, bukan crash', () => {
    const res = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'weekly',
      hours: HOURS,
      now: NOW,
      reservations: [row('null', null), row('invalid', 'bukan-tanggal'), row('ok', wib(2026, 11, 2, 10))],
    });
    expect(res.quality.missingBookingDate).toBe(2);
    expect(res.totals.count).toBe(1);
  });

  it('meneruskan hitungan reservasi non-completed yang sengaja dikecualikan', () => {
    const res = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'monthly',
      hours: HOURS,
      now: NOW,
      reservations: [row('a', wib(2026, 11, 2, 10))],
      excludedNonCompleted: 7,
    });
    expect(res.quality.excludedNonCompleted).toBe(7);
  });
});

describe('buildTreatmentHeatmap — batas bulan WIB', () => {
  it('booking 00:30 WIB tanggal 1 masuk bulan berjalan, bukan bulan sebelumnya', () => {
    const res = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'monthly',
      hours: HOURS,
      now: NOW,
      reservations: [row('midnight', wib(2026, 11, 1, 0, 30))],
    });
    expect(res.days!.find((d) => d.dateKey === '2026-11-01')!.count).toBe(1);
    expect(res.totals.count).toBe(1);
  });

  it('booking 23:30 WIB tanggal 31 Oktober tidak bocor ke November', () => {
    const res = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'monthly',
      hours: HOURS,
      now: NOW,
      reservations: [row('oct', wib(2026, 10, 31, 23, 30))],
    });
    expect(res.totals.count).toBe(0);
    expect(res.days!.reduce((s, d) => s + d.count, 0)).toBe(0);
  });

  it('booking 23:59 WIB di hari terakhir bulan tetap dihitung', () => {
    const res = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'monthly',
      hours: HOURS,
      now: NOW,
      reservations: [row('last', wib(2026, 11, 30, 23, 59))],
    });
    expect(res.days!.find((d) => d.dateKey === '2026-11-30')!.count).toBe(1);
  });
});

describe('buildTreatmentHeatmap — scope monthly (kalender)', () => {
  it('membuat satu sel per tanggal dengan nama hari yang benar', () => {
    const res = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'monthly',
      hours: HOURS,
      now: NOW,
      reservations: [],
    });
    expect(res.days).toHaveLength(30);
    expect(res.days![0]).toMatchObject({
      dateKey: '2026-11-01',
      dayOfMonth: 1,
      dayIndex: 6, // 1 Nov 2026 = Minggu
      dayName: 'Min',
    });
    expect(res.days![1]).toMatchObject({ dateKey: '2026-11-02', dayIndex: 0, dayName: 'Sen' });
  });

  it('menandai hari ini dan hari mendatang berbasis WIB', () => {
    const res = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'monthly',
      hours: HOURS,
      now: NOW, // 13 Nov 2026 12:00 WIB
      reservations: [],
    });
    const today = res.days!.find((d) => d.dateKey === '2026-11-13')!;
    expect(today.isToday).toBe(true);
    expect(today.isFuture).toBe(false);
    expect(res.days!.find((d) => d.dateKey === '2026-11-14')!.isFuture).toBe(true);
    expect(res.days!.find((d) => d.dateKey === '2026-11-12')!.isFuture).toBe(false);
  });
});

describe('buildTreatmentHeatmap — scope multi (beberapa bulan)', () => {
  it('memuat tepat N bulan berakhir di bulan terpilih', () => {
    const res = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'multi',
      monthCount: 3,
      hours: HOURS,
      now: NOW,
      reservations: [
        row('sep', wib(2026, 9, 5, 10)),
        row('oct', wib(2026, 10, 5, 10)),
        row('nov', wib(2026, 11, 5, 10)),
        // Di luar jendela 3 bulan (Agustus) → tidak dihitung.
        row('aug', wib(2026, 8, 5, 10)),
      ],
    });
    expect(res.months!.map((m) => `${m.year}-${m.month}`)).toEqual(['2026-9', '2026-10', '2026-11']);
    expect(res.months!.map((m) => m.count)).toEqual([1, 1, 1]);
    expect(res.totals.count).toBe(3);
    expect(res.months![2].peakDay).toEqual({ dateKey: '2026-11-05', count: 1 });
  });

  it('menjepit monthCount ke 1..12', () => {
    const low = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'multi',
      monthCount: 0,
      hours: HOURS,
      now: NOW,
      reservations: [],
    });
    expect(low.months).toHaveLength(1);
    const high = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'multi',
      monthCount: 99,
      hours: HOURS,
      now: NOW,
      reservations: [],
    });
    expect(high.months).toHaveLength(12);
  });
});

describe('buildTreatmentHeatmap — konsistensi & determinisme', () => {
  it('total scope weekly sama dengan total kalender bulanan', () => {
    const reservations = [
      row('a', wib(2026, 11, 2, 10)),
      row('b', wib(2026, 11, 2, 7)),
      row('c', wib(2026, 11, 30, 23, 59)),
    ];
    const weekly = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'weekly',
      hours: HOURS,
      now: NOW,
      reservations,
    });
    const monthly = buildTreatmentHeatmap({
      year: 2026,
      month: 11,
      scope: 'monthly',
      hours: HOURS,
      now: NOW,
      reservations,
    });
    expect(weekly.totals.count).toBe(monthly.totals.count);
    expect(weekly.weeks!.reduce((s, w) => s + w.count, 0)).toBe(weekly.totals.count);
  });

  it('input sama + now sama menghasilkan output identik', () => {
    const params = {
      year: 2026 as const,
      month: 11 as const,
      scope: 'weekly' as const,
      hours: HOURS,
      now: NOW,
      reservations: [row('a', wib(2026, 11, 2, 10))],
    };
    expect(buildTreatmentHeatmap(params)).toEqual(buildTreatmentHeatmap(params));
  });
});
