import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';

/**
 * Sesi 887216 (halusinasi 2 anak): "ini anak saya lagi pilek" (tanpa usia)
 * lalu "Kalau umur 16 bulan bu juga sama 45 menit?" DILARANG membelah anak
 * tunggal menjadi 2 anak (Adik + Kakak). Kata sambung umum 'kalau' BUKAN
 * penanda entitas anak-lain. Harus tetap 1 anak dengan usia 16 bulan + pilek.
 */
describe('Patient Extractor — single child tidak terbelah (sesi 887216)', () => {
  it('"anak saya lagi pilek" + "Kalau umur 16 bulan..." → tepat 1 anak (usia 16, pilek)', () => {
    let kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda' } as any,
      'ini anak saya lagi pilek, apa bisa ya dipijat ?'
    );
    expect(kids).toHaveLength(1);
    expect(kids[0].symptoms).toContain('pilek');
    expect(kids[0].ageMonths ?? null).toBeNull();

    kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda', children: kids } as any,
      'Kalau umur 16 bulan bu juga sama 45 menit?'
    );
    expect(kids).toHaveLength(1);
    expect(kids[0].ageMonths).toBe(16);
    expect(kids[0].symptoms).toContain('pilek');
  });

  it('PERAN EKSPLISIT tetap membelah ("kakak" / "adik") — perilaku lestari', () => {
    let kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda' } as any,
      'anak saya umur 16 bulan lagi pilek'
    );
    expect(kids).toHaveLength(1);
    kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda', children: kids } as any,
      'kakaknya yang umur 3 tahun juga mau dipijat'
    );
    expect(kids).toHaveLength(2);
    expect(kids[1]).toMatchObject({ roleLabel: 'Kakak', ageMonths: 36 });
  });

  it('usia berbeda pada anak yang SUDAH ber-usia → tetap 2 anak (branch c)', () => {
    let kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda' } as any,
      'bayi saya umur 2 bulan'
    );
    kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda', children: kids } as any,
      'anak saya umur 17 bulan minta pijat'
    );
    expect(kids).toHaveLength(2);
    expect(kids[0]).toMatchObject({ roleLabel: 'Adik', ageMonths: 2 });
    expect(kids[1]).toMatchObject({ roleLabel: 'Kakak', ageMonths: 17 });
  });
});
