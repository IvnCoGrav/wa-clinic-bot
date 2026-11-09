import { describe, it, expect } from 'vitest';
import { checkMedicalKeywords } from '../../src/config/medical-keywords';

describe('CFG-01: Medical Keywords Non-Medical Phrase Scoping & Emergency Priority', () => {
  it('should NOT trigger medical emergency when message only contains non-medical phrase "step by step"', () => {
    const result = checkMedicalKeywords('tolong jelaskan alur pemesanan step by step ya bunda');
    expect(result.isMedical).toBe(false);
    expect(result.severity).toBe('NONE');
    expect(result.detectedSymptoms).toHaveLength(0);
  });

  it('MUST detect HIGH severity emergency when message contains "step by step" AND "kejang"', () => {
    const result = checkMedicalKeywords('tolong step by step anak saya kejang');
    expect(result.isMedical).toBe(true);
    expect(result.severity).toBe('HIGH');
    expect(result.detectedSymptoms).toContain('kejang');
  });

  it('MUST detect HIGH severity emergency when message contains "step by step" AND "demam tinggi"', () => {
    const result = checkMedicalKeywords('bunda tolong pandu step by step bayi saya demam tinggi');
    expect(result.isMedical).toBe(true);
    expect(result.severity).toBe('HIGH');
    expect(result.detectedSymptoms).toContain('demam tinggi');
  });

  it('MUST detect HIGH severity emergency when message contains "step by step" AND "sesak napas"', () => {
    const result = checkMedicalKeywords('tolong jelaskan step by step cara mengatasi anak sesak napas');
    expect(result.isMedical).toBe(true);
    expect(result.severity).toBe('HIGH');
    expect(result.detectedSymptoms).toContain('sesak napas');
  });

  it('MUST detect genuine colloquial seizure keyword "step" when not part of "step by step"', () => {
    const result = checkMedicalKeywords('bayi saya mendadak step panas');
    expect(result.isMedical).toBe(true);
    expect(result.severity).toBe('HIGH');
    expect(result.detectedSymptoms).toContain('step');
  });
});
