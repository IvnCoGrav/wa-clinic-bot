/**
 * Fase 1 — State Maternal Terstruktur.
 *
 * Kontrak yang diuji:
 *  1. Token tahap ibu KANONIS lintas lapisan (chat `BREASTFEEDING` → `LACTATING`).
 *  2. Ekstraksi usia kehamilan label-first — DILARANG menelan usia anak.
 *  3. HPL = anchor + (40 − minggu) × 7 hari.
 *  4. Tanpa konteks Moms → semua null (anti false-positive).
 */
import { describe, it, expect } from 'vitest';
import {
  canonicalMomStage,
  extractGestationalWeeksFromRawText,
  computeHplDate,
  resolveMaternalState,
} from '../../src/services/maternal-state.service';

describe('Fase 1 — maternal-state.service', () => {
  describe('canonicalMomStage', () => {
    it('memetakan BREASTFEEDING (kontrak chat) ke LACTATING (kontrak data)', () => {
      expect(canonicalMomStage('BREASTFEEDING')).toBe('LACTATING');
      expect(canonicalMomStage('lactating')).toBe('LACTATING');
    });

    it('menerima sinonim bahasa Indonesia', () => {
      expect(canonicalMomStage('hamil')).toBe('PREGNANT');
      expect(canonicalMomStage('nifas')).toBe('POSTPARTUM');
      expect(canonicalMomStage('menyusui')).toBe('LACTATING');
    });

    it('nilai tak dikenal / kosong → null (DILARANG ditebak)', () => {
      expect(canonicalMomStage(undefined)).toBeNull();
      expect(canonicalMomStage('')).toBeNull();
      expect(canonicalMomStage('BUNDLE')).toBeNull();
    });
  });

  describe('extractGestationalWeeksFromRawText', () => {
    it('membaca label "Usia Kehamilan: 38 minggu"', () => {
      expect(extractGestationalWeeksFromRawText('Usia Kehamilan: 38 minggu')).toBe(38);
    });

    it('label-first: "Bayi 9 bulan, Bunda hamil 38 minggu" → 38 (bukan 9)', () => {
      expect(extractGestationalWeeksFromRawText('Bayi 9 bulan, Bunda hamil 38 minggu')).toBe(38);
    });

    it('membaca singkatan UK', () => {
      expect(extractGestationalWeeksFromRawText('UK 32 weeks')).toBe(32);
    });

    it('usia anak murni tanpa penanda kehamilan → null', () => {
      expect(extractGestationalWeeksFromRawText('Bayi 9 bulan')).toBeNull();
    });

    it('angka di luar rentang biologis ditolak', () => {
      expect(extractGestationalWeeksFromRawText('Usia Kehamilan: 99 minggu')).toBeNull();
    });
  });

  describe('computeHplDate', () => {
    it('usia 30 minggu pada 2026-01-01 → HPL 2026-03-12 (10 minggu = 70 hari)', () => {
      const hpl = computeHplDate(new Date('2026-01-01T00:00:00Z'), 30);
      expect(hpl?.toISOString().slice(0, 10)).toBe('2026-03-12');
    });

    it('usia 40 minggu → HPL = anchor', () => {
      const anchor = new Date('2026-01-01T00:00:00Z');
      expect(computeHplDate(anchor, 40)?.toISOString().slice(0, 10)).toBe('2026-01-01');
    });

    it('input invalid → null', () => {
      expect(computeHplDate(new Date('invalid'), 30)).toBeNull();
      expect(computeHplDate(new Date(), 0)).toBeNull();
    });
  });

  describe('resolveMaternalState', () => {
    it('eksplisit (state sesi) menang atas teks', () => {
      const out = resolveMaternalState({
        rawText: 'Usia Kehamilan: 20 minggu',
        treatmentCategory: 'MOMS',
        gestationalWeeks: 38,
        momStage: 'PREGNANT',
        anchorAt: new Date('2026-01-01T00:00:00Z'),
      });
      expect(out.gestationalWeeks).toBe(38);
      expect(out.momStage).toBe('PREGNANT');
      expect(out.hplDate?.toISOString().slice(0, 10)).toBe('2026-01-15');
    });

    it('fallback raw_text saat state sesi kosong', () => {
      const out = resolveMaternalState({
        rawText: '[V3] Kala Mom – Pregnant Massage | 2026-11-05\nUsia Kehamilan: 38 minggu\nKondisi Ibu: Ibu Hamil',
        treatmentCategory: 'MOMS',
        anchorAt: new Date('2026-11-05T00:00:00Z'),
      });
      expect(out.gestationalWeeks).toBe(38);
      expect(out.momStage).toBe('PREGNANT');
      expect(out.hplDate).not.toBeNull();
    });

    it('nifas tanpa minggu gestasional → POSTPARTUM, weeks null', () => {
      const out = resolveMaternalState({
        rawText: 'Pasca Salin / Nifas 2 minggu',
        treatmentCategory: 'MOMS',
      });
      expect(out.gestationalWeeks).toBeNull();
      expect(out.momStage).toBe('POSTPARTUM');
      expect(out.hplDate).toBeNull();
    });

    it('MOMS tanpa bukti tahap → momStage null (DILARANG menebak GENERAL)', () => {
      const out = resolveMaternalState({
        rawText: 'Kala Mom – Pijat Relaksasi',
        treatmentCategory: 'MOMS',
      });
      expect(out.gestationalWeeks).toBeNull();
      expect(out.momStage).toBeNull();
      expect(out.hplDate).toBeNull();
    });

    it('bukan konteks Moms → semua null', () => {
      const out = resolveMaternalState({
        rawText: 'Pijat Bayi Ceria 40 menit',
        treatmentCategory: 'BABY',
      });
      expect(out).toEqual({ gestationalWeeks: null, momStage: null, hplDate: null });
    });
  });
});
