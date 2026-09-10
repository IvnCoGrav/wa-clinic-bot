import { describe, it, expect } from 'vitest';
import { PersonaPromptBuilder } from '../../../src/v3/agent/persona';
import { V3ConversationSummarizer } from '../../../src/v3/state/conversation-summarizer';

/**
 * Phase 3+5 (audit 833178 Turn 5) — kontrak anti-redundansi: treatment yang
 * baru dijelaskan + disetujui customer DILARANG didikte ulang dari awal.
 * Sinyal mesin (selectedTreatment/sudahDibahas) + aturan persona mendukungnya.
 */
describe('Anti-Redundant Treatment Description', () => {
  it('persona memuat aturan anti-redundansi saat sepakat', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('ANTI-REDUNDANSI PENJELASAN TREATMENT');
    expect(prompt).toContain('kami catat untuk');
    expect(prompt).toContain('DILARANG mengulang kembali penjelasan deskripsi panjang katalog');
  });

  it('aturan menghormati mode: transaksional sebut total, konsultasi tanpa nominal', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('mode transaksional');
    expect(prompt).toContain('mode konsultasi');
  });

  it('sinyal mesin: treatment terpilih tercatat di ringkasan (acuan "sudah tahu")', () => {
    const summary = V3ConversationSummarizer.summarize(
      { genderGreeting: 'Bunda', selectedTreatment: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)' } as any,
      'tidak ada, saya ambil treatment nya',
      { history: [], customerInput: 'tidak ada, saya ambil treatment nya' }
    );
    expect(summary).toContain('Pijat Bayi Pulih Ceria');
  });
});
