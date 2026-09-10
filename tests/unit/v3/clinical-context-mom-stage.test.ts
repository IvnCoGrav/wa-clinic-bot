import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';

/**
 * Phase 2 — Clinical linkage: bayi sudah lahir -> Bunda otomatis postpartum.
 * MOMS + POSTPARTUM: Oksitosin Fullbody #1, Paket Laktasi #2, TANPA prenatal.
 */
describe('Clinical Context Mom Stage (MOMS + POSTPARTUM)', () => {
  it('MOMS POSTPARTUM -> oksitosin #1, laktasi #2, tanpa prenatal', async () => {
    const out = await executeGetCatalog({
      category: 'MOMS',
      momStage: 'POSTPARTUM',
      inquirePrice: true,
    });
    expect(out.success).toBe(true);
    expect(out.treatments.length).toBeGreaterThan(1);
    expect(out.treatments[0].id).toBe('moms-oksitosin-fullbody');
    expect(out.treatments[1].id).toBe('moms-paket-laktasi');
    expect(out.treatments.some((t) => t.id === 'moms-prenatal-massage')).toBe(false);
    expect(out.treatments.some((t) => t.id === 'moms-prenatal-yoga')).toBe(false);
  });

  it('MOMS tanpa POSTPARTUM -> katalog tidak difilter (perilaku lama)', async () => {
    const out = await executeGetCatalog({ category: 'MOMS', inquirePrice: true });
    expect(out.success).toBe(true);
    expect(out.treatments.length).toBeGreaterThan(0);
  });

  it('query eksplisit prenatal tetap dihormati walau POSTPARTUM', async () => {
    const out = await executeGetCatalog({
      category: 'MOMS',
      momStage: 'POSTPARTUM',
      specificTreatmentName: 'prenatal massage',
      inquirePrice: true,
    });
    expect(out.success).toBe(true);
    expect(out.treatments.some((t) => t.id === 'moms-prenatal-massage')).toBe(true);
  });

  it('session bayi 3 minggu -> prompt memuat mandat postpartum (tanpa prenatal)', () => {
    const children = GoalTracker.syncChildrenProfiles({ genderGreeting: 'Bunda' } as any, 'bayi saya umur 3 minggu');
    expect(children[0]?.ageMonths).not.toBeUndefined();
    const prompt = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      children,
    } as any);
    expect(prompt).toContain('PASCA MELAHIRKAN');
    expect(prompt).toContain("momStage: 'POSTPARTUM'");
  });

  it('ibu hamil + anak balita -> TIDAK dimandatkan postpartum', () => {
    const prompt = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      momProfile: { stage: 'PREGNANT', gestationalWeeks: 38, complaints: [] },
      children: [{ roleLabel: 'Kakak', ageMonths: 24, symptoms: [] }],
    } as any);
    expect(prompt).not.toContain('PASCA MELAHIRKAN');
  });
});
