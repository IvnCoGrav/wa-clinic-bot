import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';

/**
 * Phase 3+5 (audit 222655) — adversarial multi-anak: usia kedua TANPA label
 * peran DILARANG menimpa anak pertama; dialokasikan ke slot Kakak/Adik.
 */
describe('Multi-Child Allocator (audit 222655 replay)', () => {
  it('Turn3 2bln -> Turn5 17bln: 2 slot (Adik 2 + Kakak 17)', () => {
    let kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda' } as any, 'bayi saya umur 2 bulan'
    );
    expect(kids).toHaveLength(1);
    expect(kids[0].ageMonths).toBe(2);
    kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda', children: kids } as any, 'anak saya umur 17 bulan minta pijat'
    );
    expect(kids).toHaveLength(2);
    expect(kids[0]).toMatchObject({ roleLabel: 'Adik', ageMonths: 2 });
    expect(kids[1]).toMatchObject({ roleLabel: 'Kakak', ageMonths: 17 });
  });

  it('urutan terbalik: 17bln dulu -> 2bln selip jadi Adik', () => {
    let kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda' } as any, 'anak saya umur 17 bulan'
    );
    kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda', children: kids } as any, 'bayi saya umur 2 bulan'
    );
    expect(kids).toHaveLength(2);
    expect(kids[0]).toMatchObject({ roleLabel: 'Adik', ageMonths: 2 });
    expect(kids[1].ageMonths).toBe(17);
  });

  it('penyebutan ulang usia sama -> update gejala, TANPA slot baru', () => {
    let kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda' } as any, 'bayi saya umur 2 bulan'
    );
    kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda', children: kids } as any, 'yang 2 bulan lagi pilek'
    );
    expect(kids).toHaveLength(1);
    expect(kids[0].symptoms).toContain('pilek');
  });

  it('gejala tanpa usia menempel ke anak pertama (perilaku lama lestari)', () => {
    let kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda' } as any, 'bayi saya umur 2 bulan'
    );
    kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda', children: kids } as any, 'lagi batuk pilek'
    );
    expect(kids).toHaveLength(1);
    expect(kids[0].symptoms).toEqual(expect.arrayContaining(['batuk', 'pilek']));
  });

  it('label peran eksplisit tetap menang (kakak 3th -> idx1)', () => {
    let kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda' } as any, 'anak saya umur 2 bulan'
    );
    kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda', children: kids } as any, 'kakaknya yang umur 3 tahun juga mau dipijat'
    );
    expect(kids).toHaveLength(2);
    expect(kids[1]).toMatchObject({ roleLabel: 'Kakak', ageMonths: 36 });
  });

  it('guard maternal presisi: "batuk" TIDAK dikira "uk" kehamilan', () => {
    expect(GoalTracker.isMaternalOnlyMessage('lagi batuk pilek')).toBe(false);
    expect(GoalTracker.isMaternalOnlyMessage('uk 38 weeks')).toBe(true);
    expect(GoalTracker.isMaternalOnlyMessage('hamil 8 bulan, uk 32')).toBe(true);
  });

  it('grounding multi-anak: header + aturan 1 kunjungan 1 ongkir', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      children: [
        { roleLabel: 'Adik', ageMonths: 2, symptoms: ['pilek'] },
        { roleLabel: 'Kakak', ageMonths: 17, symptoms: [] },
      ],
      childProfile: { ageMonths: 2, symptoms: ['pilek'] },
      cartItems: [
        { name: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)', price: 90000, promoPrice: 70000, type: 'PRIMARY', recipientScope: 'CHILD_1' },
      ],
    } as any);
    expect(text).toContain('[DATA PASIEN: MULTI-ANAK');
    expect(text).toContain('Adik');
    expect(text).toContain('Kakak');
    expect(text).toContain('1x kunjungan dengan 1x ongkir');
    expect(text).toContain('Pijat Bayi Pulih Ceria');
  });
});
