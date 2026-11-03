import { describe, it, expect } from 'vitest';
import { getCopilotStatus, formatElapsedSeconds, COPILOT_STATUS_STEPS } from '../../packages/admin-dashboard/src/utils/copilotStatus';

/**
 * Indikator progres Copilot (murni, offline). Menguji pemetaan elapsed → tahap
 * dan ketahanan input tidak wajar (negatif/NaN).
 */
describe('getCopilotStatus — label progres deterministik', () => {
  it('memetakan ambang waktu ke tahap yang benar (tangga 300 detik)', () => {
    expect(getCopilotStatus(0).stage).toBe('searching');
    expect(getCopilotStatus(9_999).stage).toBe('searching');
    expect(getCopilotStatus(10_000).stage).toBe('reasoning');
    expect(getCopilotStatus(44_999).stage).toBe('reasoning');
    expect(getCopilotStatus(45_000).stage).toBe('drafting');
    expect(getCopilotStatus(119_999).stage).toBe('drafting');
    expect(getCopilotStatus(120_000).stage).toBe('polishing');
    expect(getCopilotStatus(239_999).stage).toBe('polishing');
    expect(getCopilotStatus(240_000).stage).toBe('finalizing');
    expect(getCopilotStatus(600_000).stage).toBe('finalizing');
  });

  it('label selalu non-kosong dan berubah saat melewati ambang', () => {
    for (const step of COPILOT_STATUS_STEPS) {
      expect(getCopilotStatus(step.untilMs === Infinity ? 999_999_999 : step.untilMs - 1).label.length).toBeGreaterThan(0);
    }
    expect(getCopilotStatus(0).label).not.toBe(getCopilotStatus(60_000).label);
  });

  it('input tidak wajar (negatif/NaN) diperlakukan sebagai 0, tidak melempar', () => {
    expect(getCopilotStatus(-500).stage).toBe('searching');
    expect(getCopilotStatus(NaN).stage).toBe('searching');
    expect(() => getCopilotStatus(Infinity as any)).not.toThrow();
  });

  it('formatElapsedSeconds membulatkan ke bawah', () => {
    expect(formatElapsedSeconds(0)).toBe('0s');
    expect(formatElapsedSeconds(1_999)).toBe('1s');
    expect(formatElapsedSeconds(56_764)).toBe('56s');
    expect(formatElapsedSeconds(NaN)).toBe('0s');
  });
});
