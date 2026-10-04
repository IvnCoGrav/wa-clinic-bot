import { describe, it, expect } from 'vitest';
import { summarizeGuardrailEvents } from '../../src/cli/guardrail-radar';

/**
 * Radar guardrail (Fase 5): merangkum kejadian perbaikan-paksa dari log JSON
 * agar anomali terlihat lebih dulu. Logika murni — deterministik.
 */
describe('guardrail radar — summarizeGuardrailEvents', () => {
  it('menghitung event guardrail dari JSON pino', () => {
    const lines = [
      JSON.stringify({ level: 30, event: 'TREATMENT_AMNESIA_REPLACED', conversationId: 'c1' }),
      JSON.stringify({ level: 30, event: 'TREATMENT_AMNESIA_REPLACED', conversationId: 'c2' }),
      JSON.stringify({ level: 30, event: 'REPLY_CONTRACT_SCHEDULE_CTA' }),
      JSON.stringify({ level: 30, event: 'SOME_UNRELATED_EVENT' }),
      'bukan json sama sekali',
      '',
    ];
    const r = summarizeGuardrailEvents(lines);
    expect(r.total).toBe(3);
    expect(r.counts['TREATMENT_AMNESIA_REPLACED']).toBe(2);
    expect(r.counts['REPLY_CONTRACT_SCHEDULE_CTA']).toBe(1);
    expect(r.counts['SOME_UNRELATED_EVENT']).toBeUndefined();
    expect(r.samples['TREATMENT_AMNESIA_REPLACED'].length).toBe(2);
  });

  it('menghitung event *_UNRESOLVED (perlu review)', () => {
    const r = summarizeGuardrailEvents([
      JSON.stringify({ event: 'AGE_SOLICITATION_UNRESOLVED' }),
      JSON.stringify({ event: 'SHARELOC_SOLICITATION_UNRESOLVED' }),
    ]);
    expect(r.counts['AGE_SOLICITATION_UNRESOLVED']).toBe(1);
    expect(r.counts['SHARELOC_SOLICITATION_UNRESOLVED']).toBe(1);
  });

  it('fallback regex untuk log non-JSON berisi event', () => {
    const r = summarizeGuardrailEvents(['random prefix "event":"HOLISTIC_REVIEW_APPLIED" suffix']);
    expect(r.counts['HOLISTIC_REVIEW_APPLIED']).toBe(1);
  });

  it('tanpa event guardrail → total 0', () => {
    expect(summarizeGuardrailEvents(['', 'random text', JSON.stringify({ event: 'MESSAGE_RECEIVED' })]).total).toBe(0);
  });
});
