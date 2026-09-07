import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';

describe('GoalTracker.formatGoalSessionForPrompt — grounding bulletproof', () => {
  const baseSession: any = {
    genderGreeting: 'Bunda',
    customerName: 'Sandbox Customer',
  };

  it('lokasi terisi → baris status eksplisit DILARANG TANYA ALAMAT LAGI', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      location: {
        kelurahan: 'Pelemwatu',
        kecamatan: 'Menganti',
        kota: 'Kabupaten Gresik',
        distanceKm: 28.51,
        ongkirPromo: 30000,
        ongkirNormal: 35000,
      },
    } as any);
    expect(text).toContain('Pelemwatu');
    expect(text).toContain('[STATUS: SUDAH DIKETAHUI - DILARANG TANYA ALAMAT LAGI!]');
  });

  it('lokasi kosong → instruksi tanya kelurahan tetap muncul (tidak ada status larangan)', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({ ...baseSession } as any);
    expect(text).toContain('Belum diketahui');
    expect(text).not.toContain('DILARANG TANYA ALAMAT LAGI');
  });
});
