import { describe, it, expect } from 'vitest';
import {
  isGestationalText,
  parseAgeTextEstimate,
  parseAgeTextToBirthDate,
  parseAgeTextToMonths,
  formatClinicalAge,
  computeCurrentAge,
  computeGestationalAge,
} from '../../src/utils/age-calculator';

const REF = new Date('2026-09-29T00:00:00.000Z');

describe('isGestationalText — satu sumber kebenaran entitas Moms', () => {
  it('mengenali teks kehamilan & nifas', () => {
    expect(isGestationalText('hamil 38 minggu')).toBe(true);
    expect(isGestationalText('kehamilan 20 weeks')).toBe(true);
    expect(isGestationalText('usia kandungan 30 minggu')).toBe(true);
    expect(isGestationalText('nifas 2 minggu')).toBe(true);
    expect(isGestationalText('pasca salin')).toBe(true);
    expect(isGestationalText('ibu menyusui')).toBe(true);
    expect(isGestationalText('trimester 2')).toBe(true);
  });
  it('TIDAK salah kira usia anak', () => {
    expect(isGestationalText('36hr')).toBe(false);
    expect(isGestationalText('2 bulan 10 hari')).toBe(false);
    expect(isGestationalText('3 minggu')).toBe(false);
    expect(isGestationalText('2 tahun')).toBe(false);
    expect(isGestationalText('baru lahir')).toBe(false);
  });
});

describe('parseAgeTextToBirthDate — guard kehamilan (anti bocor ke tabel anak)', () => {
  it('teks kehamilan WAJIB null (bug Fitria: hamil 38 minggu ≠ bayi 9 bulan)', () => {
    expect(parseAgeTextToBirthDate('hamil 38 minggu', REF)).toBeNull();
    expect(parseAgeTextToBirthDate('38 minggu', REF)).not.toBeNull();
  });
  it('teks kehamilan lengkap juga null', () => {
    expect(parseAgeTextToBirthDate('Usia Kehamilan: 38 minggu', REF)).toBeNull();
    expect(parseAgeTextToBirthDate('ibu hamil 12 minggu', REF)).toBeNull();
    expect(parseAgeTextToBirthDate('nifas 3 minggu', REF)).toBeNull();
  });
  it('usia anak tetap ter-parse normal', () => {
    expect(parseAgeTextToBirthDate('36hr', REF)).not.toBeNull();
    expect(parseAgeTextToBirthDate('2th', REF)).not.toBeNull();
  });
});

describe('parseAgeTextEstimate — metadata ketidakpastian', () => {
  it('angka telanjang "8" → unparseable, bukan tebakan', () => {
    const r = parseAgeTextEstimate('8', REF);
    expect(r.birthDate).toBeNull();
    expect(r.unparseable).toBe(true);
  });
  it('rentang "1-2 bulan" → ambil batas bawah + approximate', () => {
    const r = parseAgeTextEstimate('1-2 bulan', REF);
    expect(r.birthDate).not.toBeNull();
    expect(r.approximate).toBe(true);
    expect(parseAgeTextToMonths('1 bulan')).toBe(1);
  });
  it('"10 bulan kurang 6 hari" → presisi dikurangi, bukan dibulatkan naik', () => {
    const r = parseAgeTextEstimate('10 bulan kurang 6 hari', REF);
    expect(r.birthDate).not.toBeNull();
    const days = Math.round((REF.getTime() - r.birthDate!.getTime()) / 86400000);
    expect(days).toBeLessThan(300);
    expect(days).toBeGreaterThan(280);
  });
  it('teks kehamilan → ditandai gestational, bukan child', () => {
    const r = parseAgeTextEstimate('hamil 38 minggu', REF);
    expect(r.gestational).toBe(true);
    expect(r.birthDate).toBeNull();
  });
  it('multi-subjek "2 bln & 3 thn" → ditandai multiSubject, DILARANG dijumlah', () => {
    const r = parseAgeTextEstimate('2 bln & 3 thn', REF);
    expect(r.multiSubject).toBe(true);
    expect(r.birthDate).toBeNull();
  });
  it('multi-subjek "9bulan, 5th,3th" → multiSubject (tidak dijumlah)', () => {
    expect(parseAgeTextEstimate('9bulan, 5th,3th', REF).multiSubject).toBe(true);
  });
  it('usia tunggal tetap normal (bukan multiSubject)', () => {
    const r = parseAgeTextEstimate('2 bulan 10 hari', REF);
    expect(r.multiSubject).toBe(false);
    expect(r.birthDate).not.toBeNull();
  });
});

describe('formatClinicalAge — format klinis seragam presisi hari', () => {
  it('< 30 hari → "X hari"', () => {
    expect(formatClinicalAge(new Date('2026-09-11T00:00:00Z'), REF)).toBe('18 hari');
    expect(formatClinicalAge(new Date('2026-09-29T00:00:00Z'), REF)).toBe('Baru lahir');
  });
  it('30 hari s/d 2 tahun → "X bulan Y hari"', () => {
    expect(formatClinicalAge(new Date('2026-07-29T00:00:00Z'), REF)).toBe('2 bulan');
    expect(formatClinicalAge(new Date('2026-07-19T00:00:00Z'), REF)).toBe('2 bulan 10 hari');
    expect(formatClinicalAge(new Date('2026-03-29T00:00:00Z'), REF)).toBe('6 bulan');
  });
  it('> 2 tahun → "X tahun Y bulan"', () => {
    expect(formatClinicalAge(new Date('2024-06-29T00:00:00Z'), REF)).toBe('2 tahun 3 bulan');
    expect(formatClinicalAge(new Date('2024-09-29T00:00:00Z'), REF)).toBe('2 tahun');
  });
  it('tidak ada singkatan mentah / angka telanjang', () => {
    const out = formatClinicalAge(new Date('2025-11-29T00:00:00Z'), REF);
    expect(out).toBe('10 bulan');
    expect(out).not.toMatch(/hr|bln|th\b|\b8\b/);
  });
});

describe('computeCurrentAge — on-the-fly dari rawAgeText (data lama ikut hidup)', () => {
  it('birth_date NULL + rawAgeText + registeredAt → tetap tumbuh', () => {
    const registeredAt = new Date('2026-08-20T00:00:00.000Z');
    // 36 hari saat registrasi (20 Agu) → lahir 15 Jul → hari ini (29 Sep) = 2 bulan 14 hari
    expect(computeCurrentAge({ rawAgeText: '36hr', registeredAt }, REF)).toBe('2 bulan 14 hari');
  });
  it('rawAgeText kehamilan → JANGAN dihitung sebagai usia anak', () => {
    const registeredAt = new Date('2026-08-20T00:00:00.000Z');
    expect(computeCurrentAge({ rawAgeText: 'hamil 38 minggu', registeredAt }, REF)).toBe('');
  });
  it('angka telanjang → kosong (tidak ditebak)', () => {
    expect(computeCurrentAge({ rawAgeText: '8', registeredAt: REF }, REF)).toBe('');
  });
  it('prioritas birth_date di atas rawAgeText', () => {
    expect(
      computeCurrentAge(
        { birthDate: new Date('2026-02-02T00:00:00Z'), rawAgeText: '1 tahun' },
        new Date('2026-08-02T00:00:00Z')
      )
    ).toBe('6 bulan');
  });
});

describe('computeGestationalAge — engine kehamilan/nifas dinamis', () => {
  const reg = new Date('2026-06-01T00:00:00.000Z');
  it('bertambah minggu seiring waktu', () => {
    const recentReg = new Date('2026-09-01T00:00:00.000Z');
    const r = computeGestationalAge({ registeredAt: recentReg, gestationalWeeksAtReg: 30, today: REF });
    expect(r.isPregnant).toBe(true);
    expect(r.currentWeeks).toBeGreaterThan(30);
  });
  it('melewati 41 minggu → otomatis Pasca Salin / Nifas', () => {
    const r = computeGestationalAge({ registeredAt: reg, gestationalWeeksAtReg: 38, today: REF });
    expect(r.isPregnant).toBe(false);
    expect(r.stageLabel).toContain('Nifas');
  });
  it('trimester dihitung benar', () => {
    const r = computeGestationalAge({ registeredAt: REF, gestationalWeeksAtReg: 20, today: REF });
    expect(r.stageLabel).toContain('Trimester 2');
  });
});
