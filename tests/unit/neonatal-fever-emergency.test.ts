/**
 * neonatal-fever-emergency.test.ts — Unit test aturan komposit demam neonatus.
 *
 * Konteks: RF-07 (bayi 10 hari, demam 38.2°C, mogok nyusu) lolos dari
 * checkMedicalKeywords karena threshold demam hanya >= 39°C.
 * Aturan komposit: umur < 28 hari + suhu >= 38.0°C = HIGH (Red Flag IDAI/WHO).
 *
 * Prinsip Adversarial (MANDATORY): uji ketahanan parafrase nyata —
 * urutan terbalik, varian sebutan usia/suhu, typo, slang — BUKAN hanya
 * kalimat verbatim RF-07. Order-independent (numerik, bukan hafalan pola).
 *
 * Komentar Bahasa Indonesia (konsisten repo).
 */
import { describe, it, expect } from 'vitest';
import {
  detectNeonatalFeverEmergency,
  checkMedicalKeywords,
} from '../../src/config/medical-keywords';
import { MedicalDetectionService } from '../../src/services/medical-detection.service';

describe('detectNeonatalFeverEmergency — kasus RF-07 & varian', () => {
  it('RF-07 verbatim: bayi 10 hari demam 38.2 = HIGH', () => {
    const r = detectNeonatalFeverEmergency('Bayi baru lahir umur 10 hari kok demam ya Bun, suhu 38.2.');
    expect(r.isNeonatalFever).toBe(true);
    expect(r.severity).toBe('HIGH');
    expect(r.detectedSymptoms.length).toBeGreaterThan(0);
  });

  it('urutan terbalik: suhu dulu baru umur', () => {
    const r = detectNeonatalFeverEmergency('Suhu 38.5 bun, bayi saya umur 5 hari');
    expect(r.isNeonatalFever).toBe(true);
    expect(r.severity).toBe('HIGH');
  });

  it('varian sebutan: newborn / neonatus / bayi baru lahir', () => {
    expect(detectNeonatalFeverEmergency('newborn demam 38.1').isNeonatalFever).toBe(true);
    expect(detectNeonatalFeverEmergency('bayi neonatus panas 38').isNeonatalFever).toBe(true);
    expect(detectNeonatalFeverEmergency('bayi baru lahir umur 2 hari suhu 39').isNeonatalFever).toBe(true);
  });

  it('varian desimal koma: 38,2', () => {
    const r = detectNeonatalFeverEmergency('umur 10 hari, suhu 38,2 bun');
    expect(r.isNeonatalFever).toBe(true);
  });

  it('batas ambang: tepat 28 hari = BUKAN neonatus', () => {
    const r = detectNeonatalFeverEmergency('bayi umur 28 hari demam 38.5');
    expect(r.isNeonatalFever).toBe(false);
  });

  it('batas ambang: suhu 37.9 = BUKAN darurat neonatus', () => {
    const r = detectNeonatalFeverEmergency('bayi umur 10 hari suhu 37.9');
    expect(r.isNeonatalFever).toBe(false);
  });

  it('negatif: demam tanpa info umur', () => {
    // Tanpa umur → tidak bisa simpulkan neonatus (hindari false positive)
    const r = detectNeonatalFeverEmergency('adek demam 38.5 bun');
    expect(r.isNeonatalFever).toBe(false);
  });

  it('negatif: umur hari tanpa demam/suhu', () => {
    const r = detectNeonatalFeverEmergency('bayi umur 10 hari batuk pilek');
    expect(r.isNeonatalFever).toBe(false);
  });

  it('negatif: bayi 38 hari (bukan neonatus) demam 38.2', () => {
    // 38 hari > 28 hari — di luar definisi neonatus
    const r = detectNeonatalFeverEmergency('bayi umur 38 hari demam 38.2');
    expect(r.isNeonatalFever).toBe(false);
  });

  it('negatif: usia bulan/tahun bukan hari', () => {
    expect(detectNeonatalFeverEmergency('bayi umur 3 bulan demam 38.2').isNeonatalFever).toBe(false);
    expect(detectNeonatalFeverEmergency('anak umur 2 tahun panas 38').isNeonatalFever).toBe(false);
  });

  it('input kosong aman', () => {
    expect(detectNeonatalFeverEmergency('').isNeonatalFever).toBe(false);
    expect(detectNeonatalFeverEmergency('halo bunda').isNeonatalFever).toBe(false);
  });
});

describe('MedicalDetectionService — integrasi demam neonatus', () => {
  it('RF-07 full: detectMedicalConcern = HIGH', () => {
    const r = MedicalDetectionService.detectMedicalConcern(
      'Bayi baru lahir umur 10 hari kok demam ya Bun, suhu 38.2.'
    );
    expect(r.isMedical).toBe(true);
    expect(r.severity).toBe('HIGH');
  });

  it('parafrase: mogok nyusu + demam neonatus tetap HIGH', () => {
    const r = MedicalDetectionService.detectMedicalConcern(
      'Mogok nyusu juga hari ini, bayi 10 hari demam 38.2'
    );
    expect(r.isMedical).toBe(true);
    expect(r.severity).toBe('HIGH');
  });

  it('regresi: demam >= 39 non-neonatus tetap HIGH via jalur lama', () => {
    const r = MedicalDetectionService.detectMedicalConcern('anak demam 39.5 bun');
    expect(r.isMedical).toBe(true);
    expect(r.severity).toBe('HIGH');
  });

  it('regresi: teks non-medis tetap NONE', () => {
    const r = MedicalDetectionService.detectMedicalConcern('halo bu, mau tanya jadwal pijat bayi');
    expect(r.isMedical).toBe(false);
    expect(r.severity).toBe('NONE');
  });

  it('konsistensi dengan checkMedicalKeywords untuk kasus lama', () => {
    // checkMedicalKeywords murni tidak berubah perilaku untuk non-neonatus
    const base = checkMedicalKeywords('anak demam 39.5 bun');
    expect(base.severity).toBe('HIGH');
    const neg = checkMedicalKeywords('bayi umur 10 hari kok demam ya, suhu 38.2');
    // Jalur lama tetap MISS (threshold 39) — yang menangkap adalah composite baru
    expect(neg.severity).toBe('NONE');
  });
});
