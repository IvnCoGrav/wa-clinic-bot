import { describe, it, expect } from 'vitest';
import { MedicalDetectionService } from '../../src/services/medical-detection.service';

/**
 * Skrining keselamatan istilah kultural "sawan" (audit Sesi 234800 & 477412).
 * "Sawan" beririsan dengan kejang demam (step) — DILARANG diperlakukan sebagai
 * indikasi pijat relaksasi umum. Fail-closed ke HIGH (eskalasi medis deterministik
 * di machine.ts) sampai ada taksonomi klinis DB.
 *
 * Pengecualian hardcode sementara via seam `medical-keywords.ts` (Confirmation Gate
 * disetujui user 2026-09-17): sinonim klinis DB adalah tech debt tercatat.
 */
describe('Skrining Sawan — fail-closed HIGH + anti false-positive', () => {
  it('ragam frasa sawan → HIGH (bukan pijat umum)', () => {
    const cases = [
      'Anak saya kena sawan semalam, bisa dipijat?',
      'Bayinya sawanen tadi pagi bun',
      'Apakah sawan tangis itu berbahaya?',
      'Kalau anak sawan apakah boleh pijat bayi?',
      'Sawan. Mohon info',
    ];
    for (const text of cases) {
      const res = MedicalDetectionService.detectMedicalConcern(text);
      expect(res.severity, `HIGH diharapkan untuk: "${text}"`).toBe('HIGH');
      expect(res.isMedical).toBe(true);
    }
  });

  it('adversarial: kata mirip-sawan TIDAK boleh memicu HIGH via sawan', () => {
    const fpCases: Array<{ text: string; expectSeverity: 'NONE' | 'MEDIUM' }> = [
      // "kawasan" memuat substring "sawan" — wajib lolos (word-boundary ≤6 huruf)
      { text: 'Kami tinggal di kawasan Kutisari Indah', expectSeverity: 'NONE' },
      { text: 'Apakah melayani pengiriman ke kawasan industri?', expectSeverity: 'NONE' },
      { text: 'Rumah di Kesawan, bisa homecare?', expectSeverity: 'NONE' },
      // pola NON_MEDICAL_PHRASES yang sudah ada wajib lestari
      { text: 'Ikuti perawatan step by step ya', expectSeverity: 'NONE' },
    ];
    for (const { text, expectSeverity } of fpCases) {
      const res = MedicalDetectionService.detectMedicalConcern(text);
      expect(res.severity, `tidak boleh HIGH untuk: "${text}"`).toBe(expectSeverity);
    }
  });

  it('regresi: deteksi existing tidak berubah', () => {
    const high = MedicalDetectionService.detectMedicalConcern('Anak kejang step dan demam tinggi');
    expect(high.severity).toBe('HIGH');

    const med = MedicalDetectionService.detectMedicalConcern('Bayi diare dan muntah');
    expect(med.severity).toBe('MEDIUM');

    const none = MedicalDetectionService.detectMedicalConcern('Berapa harga pijat bayi ceria?');
    expect(none.severity).toBe('NONE');
  });
});
