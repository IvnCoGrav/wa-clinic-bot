import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { ContextGrounder } from '../../src/v3/agent/pipeline/context-grounder';
import { V3ConversationSummarizer } from '../../src/v3/state/conversation-summarizer';
import { validateToolArgs } from '../../src/v3/tools/tool-schemas';

describe('Multi-Audience Patient Domain (Agent V3)', () => {
  it('kehamilan 38 weeks TIDAK bocor menjadi anak 9 bulan', () => {
    const text = 'Kak, bedanya pregnant massage dengan induksi massage fullbody apa ya ? Saya uk 38 weeks';
    expect(GoalTracker.parseGestationalWeeks(text)).toBe(38);
    expect(GoalTracker.detectTargetAudience(text)).toBe('MOMS');
    expect(GoalTracker.isMaternalOnlyMessage(text)).toBe(true);
    const children = GoalTracker.syncChildrenProfiles({ genderGreeting: 'Bunda' } as any, text);
    expect(children).toEqual([]);
    const mom = GoalTracker.syncMomProfile({ genderGreeting: 'Bunda' } as any, text);
    expect(mom?.gestationalWeeks).toBe(38);
    expect(mom?.stage).toBe('PREGNANT');
  });

  it('session anak TIDAK mengisi momProfile', () => {
    const text = 'Anak saya umur 2 bulan lagi pilek';
    const children = GoalTracker.syncChildrenProfiles({ genderGreeting: 'Bunda' } as any, text);
    expect(children[0]?.ageMonths).toBe(2);
    const mom = GoalTracker.syncMomProfile({ genderGreeting: 'Bunda' } as any, text);
    expect(mom).toBeUndefined();
  });

  it('bundle Mom & Baby menyimpan kedua profil tanpa saling menimpa', () => {
    const momText = 'Saya uk 38 weeks, capek juga';
    const kidText = 'Anak saya umur 2 bulan pilek';
    let session: any = { genderGreeting: 'Bunda' };
    const mom = GoalTracker.syncMomProfile(session, momText);
    const kids = GoalTracker.syncChildrenProfiles(session, kidText);
    session = { ...session, momProfile: mom, children: kids, targetAudience: 'BOTH' };
    expect(session.momProfile?.gestationalWeeks).toBe(38);
    expect(session.children?.[0]?.ageMonths).toBe(2);
    const summary = GoalTracker.formatGoalSessionForPrompt(session);
    expect(summary).toContain('Data Bunda');
    expect(summary).toContain('38 minggu');
    expect(summary).not.toContain('Data Si Kecil: Usia 9 bulan');
  });

  it('formatStateSummary MOMS menampilkan Data Bunda bukan Data Si Kecil', () => {
    const summary = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      targetAudience: 'MOMS',
      momProfile: { stage: 'PREGNANT', gestationalWeeks: 38, complaints: ['capek'] },
    } as any);
    expect(summary).toContain('Usia Kehamilan 38 minggu');
    expect(summary).not.toContain('9 bulan');
  });

  it('skema katalog menerima gestationalWeeks + momStage (tanpa kontaminasi childAge)', () => {
    const ok = validateToolArgs('get_catalog_and_price', {
      category: 'MOMS',
      gestationalWeeks: 38,
      momStage: 'PREGNANT',
      symptoms: ['capek'],
    });
    expect(ok.success).toBe(true);
    const bad = validateToolArgs('get_catalog_and_price', {
      category: 'MOMS',
      gestationalWeeks: 2,
    });
    expect(bad.success).toBe(false);
  });

  it('pre-grounding substantif terpicu untuk pertanyaan induksi 38 weeks', () => {
    expect(ContextGrounder.isSubstantiveForPreGrounding('Kak, bedanya pregnant massage dengan induksi massage fullbody apa ya ? Saya uk 38 weeks')).toBe(true);
    expect(ContextGrounder.isSubstantiveForPreGrounding('halo')).toBe(false);
  });

  it('summarizer audience-aware: ibu hamil tidak mengulang tanya usia anak', () => {
    const s = V3ConversationSummarizer.summarize({
      genderGreeting: 'Bunda',
      targetAudience: 'MOMS',
      momProfile: { stage: 'PREGNANT', gestationalWeeks: 38, complaints: ['capek'] },
    } as any, '38 weeks apa sudah bisa pakai yang induksi ya kak ?', { history: [], customerInput: '38 weeks apa sudah bisa pakai yang induksi ya kak ?' });
    expect(s).toContain('Usia kehamilan Bunda: 38 minggu');
    expect(s).toContain('Menanyakan usia kehamilan Bunda');
  });
});
