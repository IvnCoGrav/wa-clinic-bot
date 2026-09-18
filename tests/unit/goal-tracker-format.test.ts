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

  // Rule 2 — Strict Information Hiding (state-gated prompt pruning).
  it('lokasi ada + priceDiscussed BUKAN true → nominal ongkir TIDAK disuntik ke prompt', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      location: {
        kelurahan: 'Tenggilis Mejoyo',
        kecamatan: 'Tenggilis Mejoyo',
        kota: 'Surabaya',
        distanceKm: 12.3,
        ongkirPromo: 15000,
        ongkirNormal: 25000,
      },
    } as any);
    expect(text).not.toMatch(/Rp\s*15\.000/);
    expect(text).not.toMatch(/Rp\s*25\.000/);
    expect(text).not.toContain('• Ongkir:');
  });

  it('lokasi ada + priceDiscussed true → nominal ongkir boleh disuntik (mode transaksional)', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      priceDiscussed: true,
      location: {
        kelurahan: 'Tenggilis Mejoyo',
        kecamatan: 'Tenggilis Mejoyo',
        kota: 'Surabaya',
        distanceKm: 12.3,
        ongkirPromo: 15000,
        ongkirNormal: 25000,
      },
    } as any);
    expect(text).toContain('• Ongkir: Rp 15.000');
  });
});
