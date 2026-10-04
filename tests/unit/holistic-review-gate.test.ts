import { describe, it, expect } from 'vitest';
import {
  isHighRiskTurn,
  shouldRunHolisticReview,
} from '../../src/v3/agent/pipeline/guardrail-pipeline';

/**
 * Fase 4 (Lapis 2 reviewer AI): HANYA giliran berisiko tinggi yang MASIH
 * menyisakan pelanggaran tak-terselesaikan. Menghindari merusak jawaban benar.
 */
describe('Fase 4 — reviewer AI khusus risiko', () => {
  const catalogTool = { name: 'get_catalog_and_price', result: { treatments: [] } };

  it('bumil + katalog = berisiko tinggi', () => {
    expect(isHighRiskTurn({ momProfile: { stage: 'PREGNANT' } } as any, [catalogTool])).toBe(true);
  });
  it('katalog tanpa bumil = bukan berisiko tinggi', () => {
    expect(isHighRiskTurn({ momProfile: { stage: 'GENERAL' } } as any, [catalogTool])).toBe(false);
    expect(isHighRiskTurn(undefined, [catalogTool])).toBe(false);
  });
  it('reservasi sukses / eskalasi = berisiko tinggi', () => {
    expect(isHighRiskTurn({} as any, [{ name: 'save_reservation', result: { success: true } }])).toBe(true);
    expect(isHighRiskTurn({} as any, [{ name: 'escalate_to_human' }])).toBe(true);
  });

  it('reviewer TIDAK jalan bila tidak ada pelanggaran tersisa', () => {
    expect(shouldRunHolisticReview({ violationsDetected: ['age_solicitation_detected'], highRisk: true, hasExecuteChat: true })).toBe(false);
  });
  it('reviewer jalan saat ada pelanggaran unresolved + berisiko', () => {
    expect(shouldRunHolisticReview({ violationsDetected: ['age_solicitation_unresolved'], highRisk: true, hasExecuteChat: true })).toBe(true);
  });
  it('reviewer tidak jalan tanpa executeChat atau non-risiko', () => {
    expect(shouldRunHolisticReview({ violationsDetected: ['x_unresolved'], highRisk: true, hasExecuteChat: false })).toBe(false);
    expect(shouldRunHolisticReview({ violationsDetected: ['x_unresolved'], highRisk: false, hasExecuteChat: true })).toBe(false);
  });
});
