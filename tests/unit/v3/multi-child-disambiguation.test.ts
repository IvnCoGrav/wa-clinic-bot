import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';

/**
 * Phase 1+5 (sesi 214956) — Gerbang disambiguasi multi-anak: usia kedua
 * TANPA sinyal eksplisit menaikkan latch `isMultiChildUnconfirmed` (bukan
 * menebak sepihak); latch hanya turun oleh sinyal jumlah eksplisit.
 */
describe('Multi-Child Disambiguation Gate (sesi 214956)', () => {
  it('usia baru berbeda tanpa penegas -> unconfirmed TRUE', () => {
    expect(
      GoalTracker.detectUnconfirmedMultiChild([{ ageMonths: 17, symptoms: [] }], 'kalau umur 2 tahun')
    ).toBe(true);
  });

  it('penyebutan ulang usia sama -> FALSE (bukan anak kedua)', () => {
    expect(
      GoalTracker.detectUnconfirmedMultiChild([{ ageMonths: 17, symptoms: [] }], 'umur 17 bulan berapa harganya')
    ).toBe(false);
  });

  it('dua usia dalam satu pesan tanpa penegas -> TRUE', () => {
    expect(
      GoalTracker.detectUnconfirmedMultiChild([], 'anak saya umur 17 bulan dan 2 tahun')
    ).toBe(true);
  });

  it('penegas eksplisit "anak saya 2" -> FALSE', () => {
    expect(
      GoalTracker.detectUnconfirmedMultiChild([{ ageMonths: 17, symptoms: [] }], 'anak saya 2, umur 17 bulan dan 2 tahun')
    ).toBe(false);
    expect(GoalTracker.isExplicitChildCountSignal('anak saya 2')).toBe(true);
  });

  it('label peran eksplisit (kakak) -> FALSE + sinyal eksplisit TRUE', () => {
    expect(
      GoalTracker.detectUnconfirmedMultiChild([{ ageMonths: 2, symptoms: [] }], 'kakaknya yang umur 3 tahun juga mau dipijat')
    ).toBe(false);
    expect(GoalTracker.isExplicitChildCountSignal('kakaknya yang umur 3 tahun')).toBe(true);
  });

  it('pesan maternal murni tidak pernah memicu', () => {
    expect(GoalTracker.detectUnconfirmedMultiChild([], 'uk 38 weeks')).toBe(false);
    expect(GoalTracker.detectUnconfirmedMultiChild([{ ageMonths: 17, symptoms: [] }], 'saya hamil 8 bulan')).toBe(false);
  });

  it('frasa satu-anak adalah sinyal eksplisit (penurun latch)', () => {
    expect(GoalTracker.isExplicitChildCountSignal('cuma 1 anak kok')).toBe(true);
    expect(GoalTracker.isExplicitChildCountSignal('satu anak saja')).toBe(true);
    expect(GoalTracker.isExplicitChildCountSignal('berapa harganya?')).toBe(false);
  });

  it('grounding menyuntik MANDAT KLARIFIKASI dengan usia dinamis saat flag + konteks booking', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      targetAudience: 'BOTH',
      children: [
        { roleLabel: 'Adik', ageMonths: 17, symptoms: [] },
        { roleLabel: 'Kakak', ageMonths: 24, symptoms: [] },
      ],
      childProfile: { ageMonths: 17, symptoms: [] },
      isMultiChildUnconfirmed: true,
      cartItems: [
        { name: 'Pijat Lahap Juara', price: 95000, promoPrice: 75000, type: 'PRIMARY', recipientScope: 'CHILD_1' },
      ],
    } as any);
    expect(text).toContain('[MANDAT KLARIFIKASI JUMLAH ANAK');
    expect(text).toContain('Adik 17 bln');
    expect(text).toContain('2 th');
    expect(text).toContain('DILARANG MENEBAK');
  });

  it('grounding TANPA mandat bila flag mati / tanpa konteks booking', () => {
    const noFlag = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      children: [
        { roleLabel: 'Adik', ageMonths: 17, symptoms: [] },
        { roleLabel: 'Kakak', ageMonths: 24, symptoms: [] },
      ],
      childProfile: { ageMonths: 17, symptoms: [] },
    } as any);
    expect(noFlag).not.toContain('[MANDAT KLARIFIKASI JUMLAH ANAK');

    const noContext = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      targetAudience: 'BABY',
      children: [
        { roleLabel: 'Adik', ageMonths: 17, symptoms: [] },
        { roleLabel: 'Kakak', ageMonths: 24, symptoms: [] },
      ],
      childProfile: { ageMonths: 17, symptoms: [] },
      isMultiChildUnconfirmed: true,
    } as any);
    expect(noContext).not.toContain('[MANDAT KLARIFIKASI JUMLAH ANAK');
  });

  it('flag bertahan di session (persistensi memory offline)', async () => {
    const convId = `conv-multidis-${Date.now()}`;
    const s1 = await GoalTracker.updateGoalSession(convId, {
      children: [{ roleLabel: 'Adik', ageMonths: 17, symptoms: [] }],
      isMultiChildUnconfirmed: true,
    } as any, 'default-tenant');
    expect(s1.isMultiChildUnconfirmed).toBe(true);
    const back = await GoalTracker.getGoalSession(convId, 'default-tenant');
    expect((back as any).isMultiChildUnconfirmed).toBe(true);
  });
});
