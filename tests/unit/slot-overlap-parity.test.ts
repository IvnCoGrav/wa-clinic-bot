import { describe, it, expect } from 'vitest';
import {
  effectiveDuration,
  intervalsOverlap
} from '../../src/services/slot-overlap.service';

describe('Slot Overlap Characterization & Parity (Fase 4-2)', () => {
  describe('1. effectiveDuration clamp & fallback', () => {
    it('mengembalikan durasi valid apa adanya jika dalam rentang 15..480', () => {
      expect(effectiveDuration(60)).toBe(60);
      expect(effectiveDuration(90)).toBe(90);
      expect(effectiveDuration(15)).toBe(15);
      expect(effectiveDuration(480)).toBe(480);
      expect(effectiveDuration('120')).toBe(120);
    });

    it('clamp ke 15 menit jika nilai < 15 menit tetapi positif', () => {
      expect(effectiveDuration(10)).toBe(15);
      expect(effectiveDuration(1)).toBe(15);
      expect(effectiveDuration(14)).toBe(15);
    });

    it('clamp ke 480 menit jika nilai > 480 menit (8 jam)', () => {
      expect(effectiveDuration(500)).toBe(480);
      expect(effectiveDuration(999)).toBe(480);
      expect(effectiveDuration(10000)).toBe(480);
    });

    it('fallback ke default (60 menit) jika durasi invalid (null, undefined, 0, negatif, NaN, non-finite)', () => {
      expect(effectiveDuration(null)).toBe(60);
      expect(effectiveDuration(undefined)).toBe(60);
      expect(effectiveDuration(0)).toBe(60);
      expect(effectiveDuration(-5)).toBe(60);
      expect(effectiveDuration(-100)).toBe(60);
      expect(effectiveDuration(NaN)).toBe(60);
      expect(effectiveDuration(Infinity)).toBe(60);
      expect(effectiveDuration('bukan-angka')).toBe(60);
    });

    it('menghormati custom fallback jika diberikan', () => {
      expect(effectiveDuration(null, 90)).toBe(90);
      expect(effectiveDuration(0, 45)).toBe(45);
      expect(effectiveDuration(-10, 30)).toBe(30);
    });
  });

  describe('2. intervalsOverlap detection', () => {
    // Basis jam 10:00:00 WIB
    const base10am = new Date('2026-08-15T03:00:00.000Z'); // 10:00 WIB

    it('Back-to-back berturutan (10:00–11:00 vs 11:00–12:00) TIDAK tumpang tindih', () => {
      const slotAStart = base10am.getTime();
      const slotADur = 60; // 10:00 - 11:00
      const slotBStart = base10am.getTime() + 60 * 60000; // 11:00
      const slotBDur = 60; // 11:00 - 12:00

      // A duluan lalu B
      expect(intervalsOverlap(slotAStart, slotADur, slotBStart, slotBDur)).toBe(false);
      // B duluan lalu A
      expect(intervalsOverlap(slotBStart, slotBDur, slotAStart, slotADur)).toBe(false);
    });

    it('Overlap parsial (10:30–11:30 vs 11:00–12:00) terdeteksi tumpang tindih', () => {
      const slotAStart = base10am.getTime() + 30 * 60000; // 10:30
      const slotADur = 60; // 10:30 - 11:30
      const slotBStart = base10am.getTime() + 60 * 60000; // 11:00
      const slotBDur = 60; // 11:00 - 12:00

      expect(intervalsOverlap(slotAStart, slotADur, slotBStart, slotBDur)).toBe(true);
      expect(intervalsOverlap(slotBStart, slotBDur, slotAStart, slotADur)).toBe(true);
    });

    it('Overlap total identik (10:00–11:00 vs 10:00–11:00) terdeteksi tumpang tindih', () => {
      const start = base10am.getTime();
      expect(intervalsOverlap(start, 60, start, 60)).toBe(true);
    });

    it('Overlap subset/enclosure (10:00–12:00 vs 10:30–11:00) terdeteksi tumpang tindih', () => {
      const longStart = base10am.getTime();
      const longDur = 120; // 10:00 - 12:00
      const shortStart = base10am.getTime() + 30 * 60000; // 10:30
      const shortDur = 30; // 10:30 - 11:00

      expect(intervalsOverlap(longStart, longDur, shortStart, shortDur)).toBe(true);
      expect(intervalsOverlap(shortStart, shortDur, longStart, longDur)).toBe(true);
    });

    it('Reservasi panjang yang mulai sebelum window tetap terdeteksi (regresi R2.1)', () => {
      const earlyStart = base10am.getTime() - 120 * 60000; // 08:00
      const longDur = 180; // 08:00 - 11:00 (menabrak 10:00)
      const targetStart = base10am.getTime(); // 10:00
      const targetDur = 60; // 10:00 - 11:00

      expect(intervalsOverlap(earlyStart, longDur, targetStart, targetDur)).toBe(true);
      expect(intervalsOverlap(targetStart, targetDur, earlyStart, longDur)).toBe(true);
    });

    it('Dua interval berjauhan tanpa irisan TIDAK tumpang tindih', () => {
      const morningStart = base10am.getTime(); // 10:00 - 11:00
      const eveningStart = base10am.getTime() + 300 * 60000; // 15:00 - 16:00

      expect(intervalsOverlap(morningStart, 60, eveningStart, 60)).toBe(false);
      expect(intervalsOverlap(eveningStart, 60, morningStart, 60)).toBe(false);
    });

    it('Mendukung input Date object secara fleksibel selain number timestamp', () => {
      const dateA = new Date(base10am);
      const dateB = new Date(base10am.getTime() + 30 * 60000); // 10:30

      expect(intervalsOverlap(dateA, 60, dateB, 60)).toBe(true);
      expect(intervalsOverlap(dateA, 30, dateB, 60)).toBe(false); // 10:00-10:30 vs 10:30-11:30 (back to back)
    });
  });
});
