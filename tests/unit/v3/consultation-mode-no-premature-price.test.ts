import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';
import { PersonaPromptBuilder } from '../../../src/v3/agent/persona';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';

/**
 * Phase 1+6 (audit 854065 Turn 3) — MODE KONSULTASI: minat tanpa tanya harga
 * DILARANG memuntahkan total & menodong jadwal, di tool, prompt, & grounding.
 */
describe('Consultation Mode (no premature price/schedule)', () => {
  it('tool !inquirePrice -> consultation reply tanpa nominal & tanpa todong jadwal', async () => {
    const out = await executeGetCatalog({ specificTreatmentName: 'Lahap Juara', inquirePrice: false });
    expect(out.success).toBe(true);
    expect(out.suggestedPriceReply).toBeUndefined();
    expect(out.suggestedConsultationReply).toBeDefined();
    expect(out.suggestedConsultationReply!).not.toMatch(/Rp/i);
    expect(out.suggestedConsultationReply!).not.toMatch(/jadwalkan di hari apa/i);
    expect(out.suggestedConsultationReply!).toMatch(/Lahap Juara/);
    expect(out.message).toContain('Mode Konsultasi');
  });

  it('tool inquirePrice=true -> tetap transaksional (total + template harga)', async () => {
    const out = await executeGetCatalog(
      { specificTreatmentName: 'Pijat Bayi Pulih Ceria', inquirePrice: true },
      'default-tenant',
      { kelurahan: 'Tebel Barat', ongkirPromo: 20000 }
    );
    expect(out.suggestedPriceReply).toBeDefined();
    expect(out.suggestedPriceReply!).toContain('90.000');
    expect(out.suggestedConsultationReply).toBeUndefined();
  });

  it('persona: KONDISI A.3 + treatment bebas dipakai', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('KONDISI A.3');
    expect(prompt).toContain('MODE KONSULTASI');
    expect(prompt).not.toContain('treatment sebagai kata umum');
  });

  it('grounding: tanpa priceDiscussed -> total disembunyikan + mandat konsultasi', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      cartItems: [
        { name: 'Pijat Lahap Juara (Nafsu Makan)', price: 95000, promoPrice: 75000, type: 'PRIMARY', recipientScope: 'CHILD_1' },
      ],
      location: { rawText: 'x', kelurahan: 'Tebel Barat', ongkirPromo: 20000, ongkirNormal: 25000 },
      ongkirStatus: 'QUOTED',
    } as any);
    expect(text).not.toContain('Total Akumulasi Biaya');
    expect(text).toContain('MODE KONSULTASI');
  });

  it('grounding: priceDiscussed=true -> total resmi tampil', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      priceDiscussed: true,
      cartItems: [
        { name: 'Pijat Lahap Juara (Nafsu Makan)', price: 95000, promoPrice: 75000, type: 'PRIMARY', recipientScope: 'CHILD_1' },
      ],
      location: { rawText: 'x', kelurahan: 'Tebel Barat', ongkirPromo: 20000, ongkirNormal: 25000 },
      ongkirStatus: 'QUOTED',
    } as any);
    expect(text).toContain('Total Akumulasi Biaya');
    expect(text).toContain('95.000');
  });
});
