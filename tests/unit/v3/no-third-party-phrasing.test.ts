import { describe, it, expect } from 'vitest';
import { PersonaPromptBuilder } from '../../../src/v3/agent/persona';
import { DEFAULT_FEW_SHOT_EXEMPLARS } from '../../../src/v3/agent/few-shot-exemplars';
import { GOLD_FEW_SHOT_EXEMPLARS } from '../../../src/v3/agent/gold-few-shot-exemplars';

/**
 * Sesi 462651 — frasa pihak ketiga "Bidan yang ready" dilarang (aturan 5b/21)
 * namun diajarkan lewat contoh few-shot & template (Turn 1 & 5 bocor).
 * Invarian: frasa tersebut HANYA boleh muncul di dalam kalimat larangan
 * ("DILARANG ..."), tidak pernah sebagai contoh BENAR / idealResponse.
 */
const FORBIDDEN = /bidan yang ready/i;

describe('No Third-Party Phrasing (sesi 462651)', () => {
  it('bank few-shot: tidak ada idealResponse yang mengajarkan frasa terlarang', () => {
    const bad: string[] = [];
    for (const e of [...DEFAULT_FEW_SHOT_EXEMPLARS, ...GOLD_FEW_SHOT_EXEMPLARS]) {
      if (e?.idealResponse && FORBIDDEN.test(e.idealResponse)) bad.push(e.id);
    }
    expect(bad).toEqual([]);
  });

  it('prompt Call 2: frasa terlarang hanya di dalam kalimat DILARANG', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    const sentences = prompt.split(/(?<=[.!?])\s+/);
    const hits = sentences.filter((s) => FORBIDDEN.test(s));
    expect(hits.length).toBeGreaterThan(0); // mandat larangan tetap ada
    for (const h of hits) {
      expect(h.toLowerCase()).toMatch(/dilarang|ganti/);
    }
  });

  it('prompt Call 1 (router): frasa terlarang hanya di dalam kalimat DILARANG', () => {
    const prompt = PersonaPromptBuilder.buildRouterPrompt({ genderGreeting: 'Bunda' } as any, true);
    const sentences = prompt.split(/(?<=[.!?])\s+/);
    for (const s of sentences.filter((x) => FORBIDDEN.test(x))) {
      expect(s.toLowerCase()).toMatch(/dilarang|ganti/);
    }
  });
});
