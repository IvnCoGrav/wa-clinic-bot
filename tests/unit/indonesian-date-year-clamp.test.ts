import { describe, it, expect } from 'vitest';
import { parseIndonesianDate } from '../../src/utils/indonesian-date-parser';

/**
 * Fase 2' — Enforce tahun berjalan dinamis di parser bersama.
 * Tanggal lampau (mis. "2023" karangan LLM) DILARANG lolos sebagai booking —
 * digulir ke kemunculan berikutnya. Acuan: 16 Sep 2026 (CURRENT_YEAR dinamis).
 */
const REF = new Date(2026, 8, 16, 10, 0, 0); // 16 Sep 2026

describe('Year clamp parser tanggal Indonesia (Fase 2)', () => {
  it('tahun lampau eksplisit "18 Agustus 2023" digulir ke masa depan', () => {
    const r = parseIndonesianDate('18 Agustus 2023', REF);
    expect(r.isRecognized).toBe(true);
    expect(r.date.getFullYear()).toBeGreaterThanOrEqual(2026);
    expect(r.date.getTime()).toBeGreaterThanOrEqual(new Date(2026, 8, 16).getTime());
  });

  it('ISO lampau "2023-08-18" digulir ke masa depan', () => {
    const r = parseIndonesianDate('2023-08-18', REF);
    expect(r.isRecognized).toBe(true);
    expect(r.date.getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it('tanggal tanpa tahun yang sudah lewat tahun ini digulir ke tahun depan', () => {
    const r = parseIndonesianDate('18 Agustus', REF);
    expect(r.isRecognized).toBe(true);
    expect(r.date.getMonth()).toBe(7);
    expect(r.date.getDate()).toBe(18);
    expect(r.date.getFullYear()).toBe(2027);
  });

  it('tanggal masa depan tahun berjalan TIDAK berubah', () => {
    const r = parseIndonesianDate('20 Oktober 2026', REF);
    expect(r.isRecognized).toBe(true);
    expect([r.date.getFullYear(), r.date.getMonth(), r.date.getDate()]).toEqual([2026, 9, 20]);
  });

  it('relatif "besok" tetap valid', () => {
    const r = parseIndonesianDate('besok', REF);
    expect(r.isRecognized).toBe(true);
    expect(r.date.getDate()).toBe(17);
  });
});
