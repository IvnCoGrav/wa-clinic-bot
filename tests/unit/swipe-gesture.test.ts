import { describe, it, expect } from 'vitest';
import {
  applyRubberBand,
  isDominantHorizontal,
  resolveSwipeDirection,
  slideClassFor,
  SWIPE_RATIO,
  EDGE_RATIO,
  TAB_SWIPE_MIN_PX,
  EDGE_OPEN_MIN_PX,
  EDGE_ZONE_PX,
  SWIPE_MAX_DURATION_MS,
} from '../../packages/admin-dashboard/src/utils/swipeGesture';

describe('swipeGesture — fisika & klasifikasi gestur swipe kanonis', () => {
  describe('applyRubberBand — kurva redaman eksponensial', () => {
    it('mengembalikan 0 untuk delta 0 atau negatif', () => {
      expect(applyRubberBand(0, 100, 100)).toBe(0);
      expect(applyRubberBand(-50, 100, 100)).toBe(0);
    });

    it('mengembalikan 0 untuk parameter tidak valid (NaN / Infinity / non-positif)', () => {
      expect(applyRubberBand(Number.NaN, 100, 100)).toBe(0);
      expect(applyRubberBand(50, 0, 100)).toBe(0);
      expect(applyRubberBand(50, 100, 0)).toBe(0);
      expect(applyRubberBand(50, -100, 100)).toBe(0);
      expect(applyRubberBand(50, 100, -100)).toBe(0);
    });

    it('menghitung nilai redaman eksponensial pada delta = range', () => {
      // 100 * (1 - e^-1) = 100 * 0.63212055... ≈ 63.21
      expect(applyRubberBand(100, 100, 100)).toBeCloseTo(63.21, 2);
    });

    it('asimtotik menuju maxPx pada delta besar tanpa menabrak dinding kaku', () => {
      expect(applyRubberBand(10000, 100, 100)).toBeCloseTo(100, 6);
    });

    it('monoton naik secara kontinu', () => {
      const v60 = applyRubberBand(60, 100, 100);
      const v120 = applyRubberBand(120, 100, 100);
      expect(v60).toBeLessThan(v120);
    });
  });

  describe('isDominantHorizontal — evaluasi rasio sumbu pergerakan', () => {
    it('menguji rasio 1.8x untuk swipe navigasi', () => {
      // 60 / 30 = 2.0 > 1.8 -> true
      expect(isDominantHorizontal(60, 30)).toBe(true);
      // 60 / 35 = 1.714 < 1.8 -> false
      expect(isDominantHorizontal(60, 35)).toBe(false);
      // 60 / 40 = 1.5 < 1.8 -> false
      expect(isDominantHorizontal(60, 40)).toBe(false);
    });

    it('menolak pergerakan dominan vertikal', () => {
      expect(isDominantHorizontal(10, 40)).toBe(false);
      expect(isDominantHorizontal(0, 50)).toBe(false);
    });

    it('mendukung rasio custom (misal EDGE_RATIO 2.2)', () => {
      expect(isDominantHorizontal(60, 25, EDGE_RATIO)).toBe(true); // 60/25 = 2.4 > 2.2
      expect(isDominantHorizontal(60, 30, EDGE_RATIO)).toBe(false); // 60/30 = 2.0 < 2.2
    });
  });

  describe('resolveSwipeDirection — penentuan arah swipe', () => {
    it('mendeteksi swipe ke kiri (deltaX negatif melewati threshold)', () => {
      expect(resolveSwipeDirection(-TAB_SWIPE_MIN_PX)).toBe('left');
      expect(resolveSwipeDirection(-100)).toBe('left');
    });

    it('mendeteksi swipe ke kanan (deltaX positif melewati threshold)', () => {
      expect(resolveSwipeDirection(TAB_SWIPE_MIN_PX)).toBe('right');
      expect(resolveSwipeDirection(100)).toBe('right');
    });

    it('mengembalikan null jika belum melewati ambang batas threshold', () => {
      expect(resolveSwipeDirection(TAB_SWIPE_MIN_PX - 1)).toBeNull();
      expect(resolveSwipeDirection(-(TAB_SWIPE_MIN_PX - 1))).toBeNull();
      expect(resolveSwipeDirection(0)).toBeNull();
      expect(resolveSwipeDirection(Number.NaN)).toBeNull();
    });
  });

  describe('slideClassFor — pemetaan kelas transisi CSS directional', () => {
    it('swipe ke kiri (maju ke tab kanan) menampilkan konten masuk dari kanan', () => {
      expect(slideClassFor('left')).toBe('animate-slideInFromRight');
    });

    it('swipe ke kanan (mundur ke tab kiri) menampilkan konten masuk dari kiri', () => {
      expect(slideClassFor('right')).toBe('animate-slideInFromLeft');
    });

    it('arah none menghasilkan fadeIn biasa', () => {
      expect(slideClassFor('none')).toBe('animate-fadeIn');
    });
  });

  describe('Konstanta kanonis', () => {
    it('memiliki nilai konstanta yang terkalibrasi konsisten', () => {
      expect(SWIPE_RATIO).toBe(1.8);
      expect(EDGE_RATIO).toBe(2.2);
      expect(TAB_SWIPE_MIN_PX).toBe(60);
      expect(EDGE_OPEN_MIN_PX).toBe(45);
      expect(EDGE_ZONE_PX).toBe(30);
      expect(SWIPE_MAX_DURATION_MS).toBe(650);
    });
  });
});
