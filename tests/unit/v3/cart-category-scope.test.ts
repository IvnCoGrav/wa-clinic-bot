import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { V3AgentRunner } from '../../../src/v3/agent/agent-runner';
import { V3ConversationSummarizer } from '../../../src/v3/state/conversation-summarizer';

/**
 * Fondational Akar 2 & 3 — category-first recipient scope + conversation phase.
 * Kategori katalog menentukan scope; keyword teks ("Bunda", "oksitosin")
 * DILARANG menyebabkan cross-contamination.
 */
describe('Cart Category-First Scope', () => {
  it("BABY + teks mengandung 'Bunda' -> CHILD_1 (bukan MOMS)", () => {
    const scope = GoalTracker.detectRecipientScope(
      'Halo Bunda, pijat bayi pulih ceria bisa kak? Untuk bayi 2 bulan',
      { name: 'Pijat Bayi Pulih Ceria', category: 'BABY' }
    );
    expect(scope).toBe('CHILD_1');
  });

  it("MOMS + teks mengandung 'bayi' -> MOMS (bukan CHILD_1)", () => {
    const scope = GoalTracker.detectRecipientScope(
      'pijat oksitosin untuk bayi ya? eh maksudnya untuk saya yang punya bayi',
      { name: 'Oksitosin Massage', category: 'MOMS' }
    );
    expect(scope).toBe('MOMS');
  });

  it("BABY + teks mengandung 'oksitosin' -> CHILD_1 (anti cross-contamination)", () => {
    const scope = GoalTracker.detectRecipientScope(
      'Bunda mau oksitosin dan pijat bayi pulih ceria sekalian',
      { name: 'Pijat Bayi Pulih Ceria', category: 'BABY' }
    );
    expect(scope).toBe('CHILD_1');
  });

  it('BUNDLE -> GENERAL', () => {
    expect(
      GoalTracker.detectRecipientScope('paket mom baby dong', { name: 'Paket Mom Baby', category: 'BUNDLE' })
    ).toBe('GENERAL');
  });

  it('fallback tanpa kategori tetap pakai keyword lama', () => {
    expect(GoalTracker.detectRecipientScope('buat saya sendiri', { name: 'Custom' })).toBe('MOMS');
    expect(GoalTracker.detectRecipientScope('untuk kakak', { name: 'Custom' })).toBe('CHILD_2');
  });
});

describe('Conversation Phase (deterministik dari session)', () => {
  const base: any = { genderGreeting: 'Bunda' };

  it('GREETING bila bukan follow-up dan state kosong', () => {
    expect(V3AgentRunner.deriveConversationPhase(base, false)).toBe('GREETING');
  });

  it('ONGKIR_QUOTED bila ongkirStatus QUOTED', () => {
    const phase = V3AgentRunner.deriveConversationPhase(
      { ...base, location: { rawText: 'x', kelurahan: 'Tebel Barat' }, ongkirStatus: 'QUOTED' },
      true
    );
    expect(phase).toBe('ONGKIR_QUOTED');
  });

  it('TREATMENT_DISCUSSED bila selectedTreatment terisi', () => {
    const phase = V3AgentRunner.deriveConversationPhase(
      { ...base, selectedTreatment: 'Oksitosin Massage' },
      true
    );
    expect(phase).toBe('TREATMENT_DISCUSSED');
  });

  it('SCHEDULING bila booking.preferredDate terisi', () => {
    const phase = V3AgentRunner.deriveConversationPhase(
      { ...base, booking: { preferredDate: 'Jumat', isConfirmed: false } },
      true
    );
    expect(phase).toBe('SCHEDULING');
  });

  it('directive ONGKIR_QUOTED melarang calculate_delivery ulang', () => {
    const d = V3AgentRunner.buildPhaseDirective('ONGKIR_QUOTED', {
      ...base,
      location: { rawText: 'x', kelurahan: 'Tebel Barat', distanceKm: 5 },
      ongkirStatus: 'QUOTED',
    });
    expect(d).toContain('JANGAN panggil calculate_delivery');
    expect(d).toContain('Tebel Barat');
  });

  it('summarizer phase-aware: ban ongkir + treatment tanpa keyword', () => {
    const summary = V3ConversationSummarizer.summarize(
      {
        ...base,
        location: { rawText: 'x', kelurahan: 'Tebel Barat', distanceKm: 5, ongkirPromo: 10000 },
        ongkirStatus: 'QUOTED',
        selectedTreatment: 'Pijat Bayi Pulih Ceria',
      },
      'Untuk jumat besok apakah bisa?'
    );
    expect(summary).toContain('Menghitung ulang jarak/ongkir');
    expect(summary).toContain('Pijat Bayi Pulih Ceria');
  });
});
