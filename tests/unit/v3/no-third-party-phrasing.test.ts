import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PersonaPromptBuilder } from '../../../src/v3/agent/persona';
import { DEFAULT_FEW_SHOT_EXEMPLARS } from '../../../src/v3/agent/few-shot-exemplars';
import { GOLD_FEW_SHOT_EXEMPLARS } from '../../../src/v3/agent/gold-few-shot-exemplars';
import { getStaticFallbackTopics } from '../../../src/v3/tools/clinic-faq.tool';

/**
 * Sesi 462651 — frasa pihak ketiga "Bidan yang ready" dilarang (aturan 5b/21)
 * namun diajarkan lewat contoh few-shot & template (Turn 1 & 5 bocor).
 * Invarian: frasa tersebut HANYA boleh muncul di dalam kalimat larangan
 * ("DILARANG ..."), tidak pernah sebagai contoh BENAR / idealResponse.
 *
 * Plan 4 Phase 3: pola diperluas ke varian broker ("Bidan kami yang ready",
 * "slot Bidan kami yang ready") yang lolos dari regex lama; template fallback
 * tool & config yang customer-facing dikunci nol-toleransi.
 */
const FORBIDDEN = /bidan yang ready/i;
const FORBIDDEN_VARIANT = /bidan(\s+\w+){0,3}\s+yang\s+ready/i;

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

  it('prompt Call 1 & Call 2: varian broker ("Bidan kami/slot ... yang ready") hanya di kalimat DILARANG', () => {
    for (const prompt of [
      PersonaPromptBuilder.buildRouterPrompt({ genderGreeting: 'Bunda' } as any, true),
      PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true),
    ]) {
      const sentences = prompt.split(/(?<=[.!?])\s+/);
      const hits = sentences.filter((s) => FORBIDDEN_VARIANT.test(s));
      for (const h of hits) {
        expect(h.toLowerCase()).toMatch(/dilarang|ganti/);
      }
    }
  });

  it('fallback tool clinic-faq: suggestedReply/factualSummary bebas frasa broker', () => {
    const bad: string[] = [];
    for (const t of getStaticFallbackTopics()) {
      for (const field of [t.suggestedReply, t.factualSummary]) {
        if (field && FORBIDDEN_VARIANT.test(field)) bad.push(`${t.topic}: ${field.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('source file customer-facing: nol varian broker (clinic-faq.tool, config/persona, save-reservation.tool)', () => {
    const files = [
      'src/v3/tools/clinic-faq.tool.ts',
      'src/config/persona.ts',
      'src/v3/tools/save-reservation.tool.ts',
    ];
    const bad: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.resolve(__dirname, '../../../', f), 'utf-8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (FORBIDDEN_VARIANT.test(line)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
