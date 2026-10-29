import { describe, expect, it } from 'vitest';
import {
  GRID_END_HOUR,
  GRID_START_HOUR,
  computeNowTopPx,
} from '../../packages/admin-dashboard/src/utils/calendarTimePosition';

/**
 * Fase 3 queue kalender: garis "sekarang" (now-indicator) di view Harian.
 *
 * Risiko utama (matriks §2): posisi garis dihitung tanpa memperhitungkan
 * `hourHeight` (zoom) → garis meleset saat admin mengganti level zoom.
 * Karena itu perhitungannya fungsi murni yang menerima `hourHeight`.
 *
 * Grid menampilkan 06:00–22:00 (16 jam, `HOURS = 6..21`).
 */
describe('konstanta grid', () => {
  it('grid mulai 06:00 dan berakhir 22:00', () => {
    expect(GRID_START_HOUR).toBe(6);
    expect(GRID_END_HOUR).toBe(22);
  });
});

describe('computeNowTopPx', () => {
  const HOUR_HEIGHT = { compact: 52, standard: 90, detailed: 150 } as const;

  it('06:00 tepat di posisi 0 (atas grid)', () => {
    expect(computeNowTopPx(6, 0, HOUR_HEIGHT.standard)).toBe(0);
  });

  it('menghitung menit, bukan hanya jam', () => {
    // 08:30 = 2,5 jam dari 06:00
    expect(computeNowTopPx(8, 30, 100)).toBe(250);
    // 13:15 = 7,25 jam
    expect(computeNowTopPx(13, 15, 100)).toBeCloseTo(725, 5);
  });

  it('ikut hourHeight pada ketiga level zoom (sumber bug lama)', () => {
    expect(computeNowTopPx(9, 0, HOUR_HEIGHT.compact)).toBe(156); // 3 x 52
    expect(computeNowTopPx(9, 0, HOUR_HEIGHT.standard)).toBe(270); // 3 x 90
    expect(computeNowTopPx(9, 0, HOUR_HEIGHT.detailed)).toBe(450); // 3 x 150
  });

  it('mengembalikan null di luar jam operasional grid', () => {
    expect(computeNowTopPx(5, 59, 90)).toBeNull();
    expect(computeNowTopPx(22, 1, 90)).toBeNull();
    expect(computeNowTopPx(0, 0, 90)).toBeNull();
    expect(computeNowTopPx(23, 59, 90)).toBeNull();
  });

  it('batas tepat masih dihitung valid', () => {
    expect(computeNowTopPx(22, 0, 90)).toBe(16 * 90);
    expect(computeNowTopPx(6, 0, 90)).toBe(0);
  });

  it('tidak crash untuk input tidak wajar', () => {
    expect(computeNowTopPx(NaN, 0, 90)).toBeNull();
    expect(computeNowTopPx(9, NaN, 90)).toBeNull();
    expect(computeNowTopPx(9, 0, 0)).toBeNull();
    expect(computeNowTopPx(9, 0, -10)).toBeNull();
    expect(computeNowTopPx(9, 0, NaN)).toBeNull();
  });

  it('menit di luar 0-59 tetap dihitung proporsional (bukan crash)', () => {
    expect(computeNowTopPx(8, 90, 60)).toBe(210); // 2 jam + 90 menit
  });
});
