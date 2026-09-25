import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';

/**
 * Phase 5+6 (audit 854065) — grounding durasi multi-item dari katalog resmi
 * (termasuk Bunda), anti tebakan hafalan.
 */
describe('Multi-Item Duration Grounding', () => {
  it('2 anak + Bunda -> total 140 mnt + mandat anti-lupa-Bunda', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      priceDiscussed: true,
      cartItems: [
        { name: 'Kala Baby – Pijat Pulih Ceria', price: 100000, promoPrice: 75000, type: 'PRIMARY', recipientScope: 'CHILD_1' },
        { name: 'Kala Baby – Pijat Ceria', price: 80000, promoPrice: 70000, type: 'PRIMARY', recipientScope: 'CHILD_2' },
        { name: 'Kala Mom – Oksitosin Massage (Full Body)', price: 140000, promoPrice: 105000, type: 'PRIMARY', recipientScope: 'MOMS' },
      ],
    } as any);
    expect(text).toContain('Total Estimasi Durasi Perawatan');
    expect(text).toContain('140');
    expect(text).toContain('MANDAT ESTIMASI WAKTU');
    expect(text).toContain('Oksitosin Massage (Full Body) 60 mnt');
  });

  it('1 item -> TANPA blok durasi', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      cartItems: [
        { name: 'Kala Baby – Pijat Ceria', price: 80000, promoPrice: 70000, type: 'PRIMARY', recipientScope: 'CHILD_1' },
      ],
    } as any);
    expect(text).not.toContain('Total Estimasi Durasi');
  });

  it('item tak dikenal katalog dilewati (anti fabrikasi)', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      cartItems: [
        { name: 'Kala Baby – Pijat Ceria', price: 80000, promoPrice: 70000, type: 'PRIMARY', recipientScope: 'CHILD_1' },
        { name: 'Layanan Khayalan XYZ', price: 50000, promoPrice: 40000, type: 'PRIMARY', recipientScope: 'CHILD_2' },
      ],
    } as any);
    expect(text).toContain('Total Estimasi Durasi Perawatan');
    // Hanya Ceria (40 mnt) yang terhitung; item khayalan dilewati
    expect(text).toContain('~40 menit');
    expect(text).not.toMatch(/Khayalan.*mnt/);
  });
});
