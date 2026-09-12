import { describe, it, expect } from 'vitest';
import { PersonaPromptBuilder } from '../../../src/v3/agent/persona';

/**
 * Sesi 462651 Turn 4 ("untuk perut kembung bisa ya?" → "Tentu saja bisa ...
 * sangat efektif ... ingin reservasi? hari apa?" tanpa tool):
 * keluhan fisik baru WAJIB di-routing ke tool + larangan afirmasi mutlak,
 * overclaim, dan todongan ganda di level prompt.
 */
describe('Symptom Bypass Guard (sesi 462651 Turn 4)', () => {
  it('router: keluhan fisik baru WAJIB get_catalog_and_price, DILARANG jawab langsung', () => {
    const prompt = PersonaPromptBuilder.buildRouterPrompt({ genderGreeting: 'Bunda' } as any, false);
    expect(prompt).toContain('get_catalog_and_price');
    expect(prompt).toMatch(/keluhan fisik BARU/i);
    expect(prompt).toMatch(/DILARANG menjawab afirmasi langsung tanpa data tool/);
  });

  it('Call 2 (A.2): larangan afirmasi mutlak, overclaim, todong ganda', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('ANTI-AFIRMASI MUTLAK');
    expect(prompt).toContain('Tentu saja bisa');
    expect(prompt).toContain('sangat efektif');
    // Keduanya hanya boleh muncul di dalam kalimat larangan:
    const sentences = prompt.split(/(?<=[.!?])\s+/);
    for (const s of sentences.filter((x) => /Tentu saja bisa|sangat efektif/.test(x))) {
      expect(s).toMatch(/DILARANG/);
    }
  });
});
