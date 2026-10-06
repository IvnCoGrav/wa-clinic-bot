import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { V3ConversationSummarizer } from '../../src/v3/state/conversation-summarizer';

/**
 * Regresi Fase 4.2 — usia kehamilan DINAMIS di jalur chat.
 * Angka minggu WAJIB bertambah seiring waktu sejak PERTAMA dicatat
 * (computeGestationalAge), selaras badge admin. Tanpa jangkar → angka mentah
 * (backward compat, data lama tetap valid).
 */
describe('Usia kehamilan dinamis di sesi chat (Fase 4.2)', () => {
  it('syncMomProfile mencatat jangkar saat minggu pertama diketahui', () => {
    const mom = GoalTracker.syncMomProfile({ genderGreeting: 'Bunda' } as any, 'saya hamil 30 minggu');
    expect(mom?.gestationalWeeks).toBe(30);
    expect(typeof mom?.gestationalCapturedAt).toBe('string');
    expect(Number.isNaN(new Date(mom!.gestationalCapturedAt!).getTime())).toBe(false);
  });

  it('jangkar dipertahankan bila minggu tidak berubah di turn berikutnya', () => {
    const first = GoalTracker.syncMomProfile({ genderGreeting: 'Bunda' } as any, 'saya hamil 30 minggu')!;
    const second = GoalTracker.syncMomProfile({ genderGreeting: 'Bunda', momProfile: first } as any, 'terus enaknya dipijat apa ya');
    expect(second?.gestationalWeeks).toBe(30);
    expect(second?.gestationalCapturedAt).toBe(first.gestationalCapturedAt);
  });

  it('jangkar disegarkan saat customer menyebut angka minggu BARU', () => {
    const oldAnchor = new Date('2026-09-01T00:00:00.000Z').toISOString();
    const second = GoalTracker.syncMomProfile(
      { genderGreeting: 'Bunda', momProfile: { stage: 'PREGNANT', gestationalWeeks: 30, gestationalCapturedAt: oldAnchor, complaints: [] } } as any,
      'sekarang sudah 32 minggu'
    );
    expect(second?.gestationalWeeks).toBe(32);
    expect(second?.gestationalCapturedAt).not.toBe(oldAnchor);
    expect(new Date(second!.gestationalCapturedAt!).getTime()).toBeGreaterThan(new Date(oldAnchor).getTime());
  });

  it('ringkasan prompt menumbuhkan minggu sesuai waktu berlalu sejak jangkar', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const summary = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      targetAudience: 'MOMS',
      momProfile: { stage: 'PREGNANT', gestationalWeeks: 30, gestationalCapturedAt: twoWeeksAgo, complaints: [] },
    } as any);
    expect(summary).toContain('Usia Kehamilan 32 minggu');
  });

  it('tanpa jangkar → tetap angka mentah (backward compat data lama)', () => {
    const summary = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      targetAudience: 'MOMS',
      momProfile: { stage: 'PREGNANT', gestationalWeeks: 38, complaints: [] },
    } as any);
    expect(summary).toContain('Usia Kehamilan 38 minggu');
  });

  it('summarizer ikut menumbuhkan minggu sesuai jangkar', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const s = V3ConversationSummarizer.summarize({
      genderGreeting: 'Bunda',
      targetAudience: 'MOMS',
      momProfile: { stage: 'PREGNANT', gestationalWeeks: 30, gestationalCapturedAt: twoWeeksAgo, complaints: [] },
    } as any, 'lanjut ya kak', { history: [], customerInput: 'lanjut ya kak' });
    expect(s).toContain('Usia kehamilan Bunda: 32 minggu');
  });
});
