import { describe, it, expect } from 'vitest';
import { extractDurationMinutes, cleanTreatmentDetailForDisplay } from '../../packages/admin-dashboard/src/utils/durationCalculator';

describe('extractDurationMinutes & cleanTreatmentDetailForDisplay', () => {
  it('harus mengekstrak durasi total termasuk buffer dari format multi-treatment lengkap', () => {
    const detail = 'Pijat Bayi Batuk Pilek (Adek Kenzo) [60m] + Pijat Hamil [60m] [Total 120m + Buffer 15m = 135m]';
    expect(extractDurationMinutes(detail)).toBe(135);
  });

  it('harus mengekstrak durasi total dengan buffer untuk treatment 45m + 15m = 60m', () => {
    const detail = 'Pijat Bayi Sehat [45m] [Total 45m + Buffer 15m = 60m]';
    expect(extractDurationMinutes(detail)).toBe(60);
  });

  it('harus mengekstrak durasi total dengan buffer untuk treatment 60m + 15m = 75m', () => {
    const detail = 'Baby Hydrotherapy [60m] [Total 60m + Buffer 15m = 75m]';
    expect(extractDurationMinutes(detail)).toBe(75);
  });

  it('harus mengekstrak format Total + Buffer tanpa tanda sama dengan', () => {
    const detail = 'Pijat Bayi [Total 60m + Buffer 15m]';
    expect(extractDurationMinutes(detail)).toBe(75);
  });

  it('harus mengekstrak format Total tunggal tanpa buffer', () => {
    const detail = 'Pijat Laktasi [Total 90m]';
    expect(extractDurationMinutes(detail)).toBe(90);
  });

  it('harus mengekstrak durasi dari penulisan menit alami', () => {
    const detail = 'Pijat Bayi 60 menit dan buffer 15 menit';
    expect(extractDurationMinutes(detail)).toBe(75);
  });

  it('harus mem-fallback ke estimasi cerdas untuk keyword layanan nifas / hamil', () => {
    const detail = 'Treatment Pijat Nifas Bunda';
    expect(extractDurationMinutes(detail)).toBe(90);
  });

  it('harus mem-fallback ke 60 menit untuk teks kosong / default', () => {
    expect(extractDurationMinutes(null)).toBe(60);
    expect(extractDurationMinutes('')).toBe(60);
    expect(extractDurationMinutes('Pijat')).toBe(60);
  });

  it('cleanTreatmentDetailForDisplay harus membersihkan tag buffer internal dari nama layanan', () => {
    const raw = 'Pijat Bayi Batuk Pilek (Adek Kenzo) [60m] + Pijat Hamil [60m] [Total 120m + Buffer 15m = 135m]';
    const cleaned = cleanTreatmentDetailForDisplay(raw);
    expect(cleaned).toBe('Pijat Bayi Batuk Pilek (Adek Kenzo) [60m] + Pijat Hamil [60m]');
  });
});
