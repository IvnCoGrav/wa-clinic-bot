import { describe, it, expect } from 'vitest';
import { evaluateScreeningAnswer } from '../../src/v3/agent/pipeline/medical-signal-detector';
import { PatientProfileExtractor } from '../../src/v3/state/patient-extractor';

describe('Vaccine Screening Conflict & Tri-State Clinical Triage (Task 0.5)', () => {
  it('should NOT mark isSafe=true when vaccinated this morning even if without fever ("baru vaksin tadi pagi tapi tidak demam")', () => {
    // SOP Vaksin: waktu harus cukup (48-72 jam) DAN kondisi bebas demam.
    // Jika baru vaksin tadi pagi, belum memenuhi jeda waktu aman minimal.
    const result = evaluateScreeningAnswer('baru vaksin tadi pagi tapi tidak demam');

    // Pada kode lama: hasSafeHealth ('tidak demam') bernilai true -> langsung return isSafe: true!
    // Pada tri-state triage (Fase 4): ini HARUS ditolak / isSafe false (butuh jeda/skrining).
    expect(result.isSafe).toBe(false);
  });

  it('should NOT mark isSafe=true when vaccinated 4 days ago but still having fever ("vaksin 4 hari lalu masih demam")', () => {
    // SOP Vaksin: waktu cukup (4 hari) TETAPI anak masih demam -> kontraindikasi klinis!
    const result = evaluateScreeningAnswer('vaksin 4 hari lalu masih demam');

    // Pada kode lama: hasSafeTime ('4 hari') bernilai true -> langsung return isSafe: true karena OR logic!
    // Pada tri-state triage (Fase 4): kondisi unsafeHealth (demam) harus menang -> isSafe false.
    expect(result.isSafe).toBe(false);
  });

  it('should detect suspected fever when user mentions "demam" without numeric temperature', () => {
    const text = 'anak saya badannya lagi demam dan rewel';

    // Kode lama parseFeverTemperature hanya mencari angka 35-42 °C; jika tanpa angka, mengembalikan null.
    // Fase 4 mewajibkan deteksi feverSuspected / isFeverSuspected deterministik dari kata gejala.
    const hasSuspectedFever = typeof (PatientProfileExtractor as any).isFeverSuspected === 'function'
      ? (PatientProfileExtractor as any).isFeverSuspected(text)
      : PatientProfileExtractor.parseFeverTemperature(text) !== null;

    expect(hasSuspectedFever).toBe(true);
  });
});
