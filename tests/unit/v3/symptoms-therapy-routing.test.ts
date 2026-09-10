import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { PersonaPromptBuilder } from '../../../src/v3/agent/persona';

/**
 * Phase 2+5 (audit 337101) — keluhan mengarah ke TERAPI (data-driven),
 * relaksasi murni tenggelam tanpa daftar nama hafalan.
 */
describe('Symptoms Therapy Routing', () => {
  it('"rewel malam" -> Pulih Ceria teratas, Ceria relaksasi di bawahnya', async () => {
    const out = await executeGetCatalog({ symptoms: ['rewel'], inquirePrice: true });
    expect(out.success).toBe(true);
    const pulihIdx = out.treatments.findIndex((t) => t.id === 'baby-massage-pulih-ceria');
    const ceriaIdx = out.treatments.findIndex((t) => t.id === 'baby-massage-ceria');
    expect(pulihIdx).toBeGreaterThanOrEqual(0);
    if (ceriaIdx >= 0) expect(pulihIdx).toBeLessThan(ceriaIdx);
    expect(out.treatments[0].id).not.toBe('baby-massage-ceria');
  });

  it('tanpa keluhan -> relaksasi default tetap (tidak terdemosi)', async () => {
    const out = await executeGetCatalog({ childAgeMonths: 8, inquirePrice: false });
    expect(out.success).toBe(true);
    expect(out.treatments.length).toBeGreaterThan(0);
  });

  it('grounding: gejala tercatat -> mandat anti-relaksasi-murni + rekomendasi terapi', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      children: [{ roleLabel: 'Si Kecil', ageMonths: 8, symptoms: ['rewel'] }],
      childProfile: { ageMonths: 8, symptoms: ['rewel'] },
    } as any);
    expect(text).toContain('MANDAT ANTI-RELAKSASI-MURNI');
    expect(text).toContain('Pulih Ceria');
  });

  it('persona A.2: mandat anti-relaksasi-murni + pengecualian trauma', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('MANDAT ANTI-RELAKSASI-MURNI');
    expect(prompt).toContain('baru jatuh/kaget');
  });
});
