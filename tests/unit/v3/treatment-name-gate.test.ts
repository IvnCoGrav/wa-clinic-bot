import { describe, it, expect } from 'vitest';
import { isSpecificTreatmentNameGrounded } from '../../../src/v3/tools/treatment-name-gate';

/**
 * C-007: nama layanan dari argumen tool hanya sah bila customer menyebutnya
 * di pesan TURN INI. Uji parafrase/typo, bukan kalimat hafalan.
 */
describe('Gate specificTreatmentName (C-007)', () => {
  it('nama disebut eksplisit di pesan saat ini → lolos', () => {
    expect(isSpecificTreatmentNameGrounded('Pijat Lahap Juara', 'saya mau pijat lahap juara dong')).toBe(true);
    expect(isSpecificTreatmentNameGrounded('Pijat Bayi Ceria', 'ambil yang ceria aja bun')).toBe(true);
  });

  it('nama hanya ada di riwayat / tidak disebut → ditolak', () => {
    expect(isSpecificTreatmentNameGrounded('Pijat Lahap Juara', 'oke besok ya')).toBe(false);
    expect(isSpecificTreatmentNameGrounded('Pijat Lahap Juara', '')).toBe(false);
  });

  it('nama generik tidak boleh mengunci katalog', () => {
    expect(isSpecificTreatmentNameGrounded('Pijat', 'mau pijat')).toBe(false);
    expect(isSpecificTreatmentNameGrounded('Paket Bayi', 'paket bayi ya')).toBe(false);
  });

  it('typo/urutan kata tetap dikenali lewat token signifikan', () => {
    expect(isSpecificTreatmentNameGrounded('Pijat Lahap Juara', 'pijet juara lahap bisa?')).toBe(true);
  });
});
