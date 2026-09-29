import { describe, it, expect } from 'vitest';
import { classifyPatientEntity, extractBabyDetails, buildBabyDetails } from '../../src/utils/reservation-text-parser';
import { resolveMomGestationalInfo } from '../../src/utils/age-calculator';

describe('classifyPatientEntity — gerbang kanonis Anak vs Moms', () => {
  it('teks usia gestasional → MOM walau nama ada di kolom bayi', () => {
    expect(classifyPatientEntity({ name: 'Bella', ageText: 'hamil 38 minggu' })).toBe('MOM');
    expect(classifyPatientEntity({ name: 'Fitria', ageText: '38 minggu' })).toBe('CHILD');
    expect(classifyPatientEntity({ name: 'Fitria', ageText: 'usia kandungan 20 minggu' })).toBe('MOM');
  });
  it('kategori MOMS → MOM meski usia kosong', () => {
    expect(classifyPatientEntity({ name: 'Farida', ageText: '', treatmentCategory: 'MOMS' })).toBe('MOM');
  });
  it('usia anak normal → CHILD', () => {
    expect(classifyPatientEntity({ name: 'Rara', ageText: '6 bulan', treatmentCategory: 'BABY' })).toBe('CHILD');
    expect(classifyPatientEntity({ name: 'Rara', ageText: '2 tahun' })).toBe('CHILD');
  });
  it('tanpa nama & tanpa usia → AMBIGUOUS (jangan asal tulis)', () => {
    expect(classifyPatientEntity({ name: '-', ageText: '' })).toBe('AMBIGUOUS');
    expect(classifyPatientEntity({})).toBe('AMBIGUOUS');
  });
});

describe('extractBabyDetails — isolasi entitas Moms dari tabel anak', () => {
  it('form Moms (hamil) TIDAK menghasilkan baris anak', () => {
    const raw = 'Nama Bayi: Bella\nUsia Bayi/Anak: hamil 38 minggu\nTreatment: Pijat Ibu Hamil';
    expect(extractBabyDetails(raw)).toEqual([]);
  });
  it('form anak normal tetap menghasilkan baris anak', () => {
    const raw = 'Nama Bayi: Rara\nUsia Bayi/Anak: 6 bulan';
    const rows = extractBabyDetails(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Rara');
  });
  it('campuran dua anak tetap utuh', () => {
    const rows = buildBabyDetails(['Kanaya & Kenshin'], ['1bln & 2th']);
    expect(rows.map((r) => r.name)).toEqual(['Kanaya', 'Kenshin']);
    expect(rows.map((r) => r.age)).toEqual(['1bln', '2th']);
  });
  it('campuran anak + baris gestasional hanya menyisakan anak', () => {
    const rows = buildBabyDetails(['Rara', 'Bunda Fitria'], ['6 bulan', 'hamil 38 minggu']);
    expect(rows.map((r) => r.name)).toEqual(['Rara']);
  });
});

describe('resolveMomGestationalInfo — badge Moms deterministik', () => {
  const today = new Date('2026-09-29T00:00:00.000Z');
  it('hamil 38 minggu (registrasi hari ini) → Hamil 38 minggu Trimester 3', () => {
    const info = resolveMomGestationalInfo({
      text: 'Usia Kehamilan: 38 minggu',
      treatmentCategory: 'MOMS',
      registeredAt: today,
      today,
    });
    expect(info.isPregnant).toBe(true);
    expect(info.currentWeeks).toBe(38);
    expect(info.stageLabel).toContain('Trimester 3');
  });
  it('nifas → Pasca Salin / Nifas', () => {
    const info = resolveMomGestationalInfo({ text: 'Treatment: pijat nifas', treatmentCategory: 'MOMS', registeredAt: today, today });
    expect(info.isPregnant).toBe(false);
    expect(info.stageLabel).toContain('Nifas');
  });
  it('konteks bayi → tidak ada info gestasional', () => {
    const info = resolveMomGestationalInfo({ text: 'pijat bayi 6 bulan', treatmentCategory: 'BABY', registeredAt: today, today });
    expect(info.isPregnant).toBe(false);
    expect(info.stageLabel).toBe('');
  });
});
