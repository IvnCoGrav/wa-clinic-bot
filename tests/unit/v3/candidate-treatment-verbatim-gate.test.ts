import { describe, it, expect } from 'vitest';
import { isCandidateTreatmentVerbatim } from '../../../src/v3/agent/pipeline/tool-pipeline';

/**
 * P1-4 (insiden Waru 6281390541340, 2026-10-03): router mengarang
 * `candidateTreatmentName: "Kala Baby – Pijat Ceria"` padahal customer hanya
 * mengetik "Waru". Gate verbatim membuang treatment yang tak disebut customer.
 */
describe('P1-4 — gate verbatim candidateTreatmentName', () => {
  it('treatment disebut customer → dipertahankan', () => {
    expect(isCandidateTreatmentVerbatim('Pijat Ceria', 'mau pijat ceria dong bun')).toBe(true);
    expect(isCandidateTreatmentVerbatim('pulih ceria', 'anak saya mau yang pulih ceria')).toBe(true);
  });

  it('treatment KARANGAN (tidak disebut customer) → dibuang', () => {
    expect(isCandidateTreatmentVerbatim('Kala Baby – Pijat Ceria', 'Waru')).toBe(false);
    expect(isCandidateTreatmentVerbatim('Pijat Lahap', 'rumah saya di wonokusumo')).toBe(false);
  });

  it('kosong / non-string → dibuang', () => {
    expect(isCandidateTreatmentVerbatim('', 'pijat ceria')).toBe(false);
    expect(isCandidateTreatmentVerbatim(undefined, 'pijat ceria')).toBe(false);
    expect(isCandidateTreatmentVerbatim(123, 'pijat ceria')).toBe(false);
  });

  it('teks customer kosong → dibuang (fail-safe)', () => {
    expect(isCandidateTreatmentVerbatim('Pijat Ceria', '')).toBe(false);
    expect(isCandidateTreatmentVerbatim('Pijat Ceria', undefined)).toBe(false);
  });

  it('tanda baca/spasi bebas (normalisasi) → tetap cocok', () => {
    expect(isCandidateTreatmentVerbatim('pijat-ceria', 'mau PIJAT CERIA ya')).toBe(true);
  });
});
