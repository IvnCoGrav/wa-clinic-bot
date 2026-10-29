import { describe, expect, it } from 'vitest';
import { getWeekDateRange, getWeekRange } from '../../packages/admin-dashboard/src/utils/calendarWeekRange';

/**
 * F-43: rentang minggu sebelumnya dihitung di 3 tempat (parameter API, kolom
 * grid, label header). Test ini mengunci kontrak seam tunggalnya, termasuk
 * kasus batas yang dulu bisa membuat jadwal hari Minggu hilang.
 */
const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0, 0);

describe('getWeekRange — batas minggu Senin s.d. Minggu', () => {
  it('Kamis 29 Okt 2026 → Senin 26 Okt s.d. Minggu 1 Nov', () => {
    const r = getWeekRange(noon(2026, 10, 29));
    expect(r.startDate).toBe('2026-10-26');
    expect(r.endDate).toBe('2026-11-01');
    expect(r.keys).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
  });

  it('input hari Minggu masuk ke minggu yang SEDANG berjalan (bukan minggu depan)', () => {
    const r = getWeekRange(noon(2026, 11, 1));
    expect(r.startDate).toBe('2026-10-26');
    expect(r.endDate).toBe('2026-11-01');
  });

  it('input hari Senin tetap di minggu itu', () => {
    const r = getWeekRange(noon(2026, 10, 26));
    expect(r.startDate).toBe('2026-10-26');
    expect(r.endDate).toBe('2026-11-01');
  });

  it('lintas bulan: Sabtu 1 Agu 2026 → 27 Jul s.d. 2 Agu', () => {
    const r = getWeekRange(noon(2026, 8, 1));
    expect(r.startDate).toBe('2026-07-27');
    expect(r.endDate).toBe('2026-08-02');
  });

  it('lintas tahun: Jumat 1 Jan 2027 → 28 Des 2026 s.d. 3 Jan 2027', () => {
    const r = getWeekRange(noon(2027, 1, 1));
    expect(r.startDate).toBe('2026-12-28');
    expect(r.endDate).toBe('2027-01-03');
  });

  it('tahun kabisat: 29 Feb 2028 ikut minggu 28 Feb s.d. 5 Mar', () => {
    const r = getWeekRange(noon(2028, 2, 29));
    expect(r.startDate).toBe('2028-02-28');
    expect(r.endDate).toBe('2028-03-05');
    expect(r.keys).toContain('2028-02-29');
  });

  it('selalu 7 hari berurutan tanpa duplikat/lubang', () => {
    for (const [y, m, d] of [[2026, 1, 1], [2026, 2, 28], [2026, 6, 30], [2026, 12, 31], [2027, 3, 15]] as const) {
      const r = getWeekRange(noon(y, m, d));
      expect(r.days).toHaveLength(7);
      expect(r.keys).toHaveLength(7);
      expect(new Set(r.keys).size).toBe(7);
      const ms = r.days.map((x) => x.getTime());
      for (let i = 1; i < 7; i++) expect(ms[i] - ms[i - 1]).toBe(24 * 3600 * 1000);
    }
  });

  it('idempoten: rentang dari hari Senin menghasilkan rentang yang sama', () => {
    const a = getWeekRange(noon(2026, 10, 29));
    const b = getWeekRange(a.days[0]);
    expect(b.startDate).toBe(a.startDate);
    expect(b.endDate).toBe(a.endDate);
  });

  it('tanggal acuan selalu ada di dalam rentang', () => {
    const r = getWeekRange(noon(2026, 10, 29));
    expect(r.keys).toContain('2026-10-29');
    expect(r.days[3].getDate()).toBe(29);
  });

  it('input rusak tidak melempar error dan tetap 7 hari valid', () => {
    for (const bad of [new Date(NaN), new Date('bukan tanggal'), new Date(0)]) {
      const r = getWeekRange(bad);
      expect(r.days).toHaveLength(7);
      expect(r.keys).toHaveLength(7);
      expect(r.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('getWeekDateRange memberi rentang sama dengan getWeekRange (parameter API = kolom grid)', () => {
    const date = noon(2026, 10, 29);
    const full = getWeekRange(date);
    expect(getWeekDateRange(date)).toEqual({ startDate: full.startDate, endDate: full.endDate });
  });
});
