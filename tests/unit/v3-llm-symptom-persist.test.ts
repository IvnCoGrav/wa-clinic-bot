import { describe, it, expect } from 'vitest';
import { filterSymptomsPresentInText } from '../../src/v3/agent/pipeline/tool-pipeline';

/**
 * C4 (audit #199) — Gejala dari LLM Call 1 DILARANG dipersist sebagai fakta
 * sesi bila tidak muncul di pesan user turn ini (anti kontaminasi klinis).
 */
describe('filterSymptomsPresentInText — gate verbatim gejala', () => {
  it('menyimpan gejala yang benar-benar disebut user', () => {
    expect(filterSymptomsPresentInText(['batuk', 'pilek'], 'anak saya batuk pilek bunda')).toEqual(['batuk', 'pilek']);
  });

  it('membuang gejala karangan LLM yang tidak ada di teks user', () => {
    expect(filterSymptomsPresentInText(['demam', 'kejang'], 'anak saya pilek')).toEqual([]);
  });

  it('parafrase: token signifikan tetap cocok walau ada imbuhan', () => {
    expect(filterSymptomsPresentInText(['batuk'], 'si kecil lagi batuk-batuk')).toEqual(['batuk']);
  });

  it('teks kosong → tidak ada gejala yang dipersist', () => {
    expect(filterSymptomsPresentInText(['batuk'], '')).toEqual([]);
    expect(filterSymptomsPresentInText(['batuk'], undefined as any)).toEqual([]);
  });

  it('campuran: hanya yang verbatim lolos', () => {
    expect(filterSymptomsPresentInText(['batuk', 'ruam', 'gatal'], 'badannya ruam dan batuk')).toEqual(['batuk', 'ruam']);
  });
});
