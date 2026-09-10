import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';

/**
 * Phase 3+6 (audit 854065 Turn 7) — anak pertama sakit TANPA usia tersimpan +
 * pertanyaan usia referensial -> slot Kakak, pilek adik utuh.
 */
describe('Sibling Slot Allocator (ageless sick first child)', () => {
  it('"kalau anak saya yang umur 2 tahun..." -> Kakak 24, adik tetap pilek tanpa usia', () => {
    let kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda' } as any, 'bayi saya lagi pilek'
    );
    expect(kids).toHaveLength(1);
    expect(kids[0].ageMonths).toBeUndefined();
    expect(kids[0].symptoms).toContain('pilek');
    kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda', children: kids } as any,
      'kalau anak saya yang umur 2 tahun treatment apa ya enaknya'
    );
    expect(kids).toHaveLength(2);
    expect(kids[0].symptoms).toContain('pilek');
    expect(kids[0].ageMonths).toBeUndefined();
    expect(kids[1]).toMatchObject({ roleLabel: 'Kakak', ageMonths: 24 });
  });

  it('usia telanjang susulan ("umur 2 bulan") -> isi anak pertama (bukan slot baru)', () => {
    let kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda' } as any, 'bayi saya lagi pilek'
    );
    kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda', children: kids } as any, 'umur 2 bulan'
    );
    expect(kids).toHaveLength(1);
    expect(kids[0].ageMonths).toBe(2);
    expect(kids[0].symptoms).toContain('pilek');
  });

  it('bare "yang 2 bulan" (tanpa kalau) -> usia susulan anak pertama', () => {
    let kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda' } as any, 'bayi saya lagi pilek'
    );
    kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda', children: kids } as any, 'yang 2 bulan'
    );
    expect(kids).toHaveLength(1);
    expect(kids[0].ageMonths).toBe(2);
  });
});
