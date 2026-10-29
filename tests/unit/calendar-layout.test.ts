import { describe, expect, it } from 'vitest';
import {
  DAY_COL_COUNT,
  DAY_COL_MIN_WIDTH,
  DAY_GUTTER_DESKTOP,
  DAY_GUTTER_MOBILE,
  GRID_MIN_WIDTH,
  GRID_TEMPLATE_COLUMNS,
  TIME_GUTTER,
} from '../../packages/admin-dashboard/src/utils/calendarLayout';

/**
 * F-39 / F-44: jebakan "ruang geser hantu".
 *
 * Spacer scrollbar atas dan `min-w` kanvas WAJIB sama dengan
 * `TIME_GUTTER + 7 × lebar kolom`. Kalau salah satu ditulis manual dan
 * ketinggalan saat gutter dikecilkan, kalender bisa digeser melewati kolom
 * Minggu. Test ini mengunci hubungan aritmetikanya, bukan angkanya saja.
 */
describe('calendarLayout — geometri grid mingguan', () => {
  it('lebar kanvas = gutter + 7 kolom (28 + 980 = 1008)', () => {
    expect(TIME_GUTTER).toBe(28);
    expect(DAY_COL_MIN_WIDTH).toBe(140);
    expect(DAY_COL_COUNT).toBe(7);
    expect(GRID_MIN_WIDTH).toBe(TIME_GUTTER + DAY_COL_COUNT * DAY_COL_MIN_WIDTH);
    expect(GRID_MIN_WIDTH).toBe(1008);
  });

  it('template kolom memakai gutter & lebar kolom yang sama (tidak bisa menyimpang)', () => {
    expect(GRID_TEMPLATE_COLUMNS).toBe('28px repeat(7, minmax(140px, 1fr))');
    expect(GRID_TEMPLATE_COLUMNS.startsWith(`${TIME_GUTTER}px`)).toBe(true);
    expect(GRID_TEMPLATE_COLUMNS).toContain(`minmax(${DAY_COL_MIN_WIDTH}px, 1fr)`);
    expect(GRID_TEMPLATE_COLUMNS).toContain(`repeat(${DAY_COL_COUNT},`);
  });

  it('angka lama (1020 / 1050 / gutter 40px) tidak mungkin muncul lagi dari konstanta', () => {
    expect(GRID_MIN_WIDTH).not.toBe(1020);
    expect(GRID_MIN_WIDTH).not.toBe(1050);
    // Hati-hati: '140px' mengandung '40px' — periksa awalan template, bukan substring.
    expect(GRID_TEMPLATE_COLUMNS.startsWith('40px')).toBe(false);
    expect(GRID_TEMPLATE_COLUMNS.startsWith(`${TIME_GUTTER}px`)).toBe(true);
  });

  it('gutter tetap cukup untuk 2 digit + padding kanan 2px', () => {
    // label font mono 10px ≈ 6px/digit → 12px untuk 2 digit; sisa ≥ 14px.
    const lebarLabel = 2 * 6;
    const paddingKanan = 2;
    expect(TIME_GUTTER - paddingKanan - lebarLabel).toBeGreaterThanOrEqual(14);
  });

  it('gutter Harian lebih ramping di HP daripada desktop', () => {
    expect(DAY_GUTTER_MOBILE).toBe(28);
    expect(DAY_GUTTER_DESKTOP).toBe(44);
    expect(DAY_GUTTER_MOBILE).toBeLessThan(DAY_GUTTER_DESKTOP);
  });

  it('grid mingguan lebih lebar dari layar 360px (memang harus di-scroll horizontal)', () => {
    expect(GRID_MIN_WIDTH).toBeGreaterThan(360);
  });
});
