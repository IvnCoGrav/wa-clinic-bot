import { describe, it, expect } from 'vitest';
import {
  PERSONA_DIMENSIONS,
  PERSONA_OVERALL_MIN_PASS,
  buildPersonaJudgeSystemPrompt,
  averagePersonaScore,
  failingPersonaDimensions,
  PERSONA_JUDGE_FORMAT,
} from '../../src/evals/persona-rubric';

/**
 * PLAN 9 FASE 9.2 — rubrik persona (single source untuk evaluator + harness).
 */

describe('FASE 9.2 — rubrik persona', () => {
  it('memiliki tepat 5 dimensi dengan kunci stabil', () => {
    expect(PERSONA_DIMENSIONS.map((d) => d.key)).toEqual([
      'warmth', 'golden_rules', 'grounding', 'format', 'pronoun',
    ]);
  });

  it('rata-rata 5 dimensi dihitung benar', () => {
    const avg = averagePersonaScore({ warmth: 5, golden_rules: 4, grounding: 4, format: 3, pronoun: 5 });
    expect(avg).toBeCloseTo(4.2, 5);
  });

  it('adversarial: dimensi hilang / di luar rentang → null (bukan skor palsu)', () => {
    expect(averagePersonaScore({ warmth: 5, golden_rules: 4 } as any)).toBeNull();
    expect(averagePersonaScore({ warmth: 5, golden_rules: 4, grounding: 4, format: 3, pronoun: 9 } as any)).toBeNull();
    expect(averagePersonaScore(null)).toBeNull();
  });

  it('failing dimensions memakai ambang per-dimensi', () => {
    const failing = failingPersonaDimensions({ warmth: 3, golden_rules: 3, grounding: 5, format: 5, pronoun: 5 });
    expect(failing).toEqual(['golden_rules']);
  });

  it('prompt judge memuat semua kunci dimensi + format JSON', () => {
    const sys = buildPersonaJudgeSystemPrompt();
    for (const d of PERSONA_DIMENSIONS) {
      expect(sys).toContain(d.key);
    }
    expect(sys).toContain('feedback');
    expect(PERSONA_JUDGE_FORMAT).toContain('warmth');
  });

  it('ambang keseluruhan terdokumentasi', () => {
    expect(PERSONA_OVERALL_MIN_PASS).toBe(3.5);
  });
});
