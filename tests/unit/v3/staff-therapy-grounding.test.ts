import { describe, it, expect } from 'vitest';
import { resolveChunkKeywords } from '../../../src/services/keyword-enrichment.service';
import { PersonaPromptBuilder, extractFastIntents } from '../../../src/v3/agent/persona';

/**
 * Phase 1+3 (audit 315036) — grounding alokasi bidan & definisi terapi:
 * kurasi keywords, RAG in-memory retrieval, guardrail persona, intent jadwal.
 */
describe('Staff & Therapy Grounding', () => {
  it('judul SOP alokasi bidan ter-resolve ke keywords orang/tenaga', () => {
    const kw = resolveChunkKeywords(
      'Apakah terapis/bidan yang memijat si kecil dan Bunda sama atau berbeda orangnya?',
      null
    );
    expect(kw).not.toBeNull();
    for (const w of ['satu orang', 'berurutan', 'yang memijat']) {
      expect(kw!).toContain(w);
    }
  });

  it('RAG in-memory: "sama/beda" me-retrieve artikel alokasi bidan', async () => {
    const { knowledgeBaseService } = await import('../../../src/services/knowledge.service');
    await knowledgeBaseService.addFaqItem({
      tenantId: 'default-tenant',
      category: 'SOP',
      question: 'Apakah terapis/bidan yang memijat si kecil dan Bunda sama atau berbeda orangnya?',
      answer: 'Untuk perawatan si kecil dan Bunda dalam satu kunjungan, seluruh perawatan ditangani langsung oleh 1 Bidan profesional kami yang sama dan dikerjakan secara berurutan dalam 1 kunjungan ya Bunda.',
      keywords: 'terapis, bidan, sama, beda, berbeda, orang, satu orang, yang memijat, staf, berurutan',
    });
    const chunks = await knowledgeBaseService.searchRelevantChunks(
      'Nanti yg pijat sama atau beda ya orangnya?',
      5,
      'default-tenant'
    );
    expect(chunks.some((c: any) => (c.title || '').includes('sama atau berbeda'))).toBe(true);
  });

  it('persona memuat guardrail alokasi staf & definisi terapi', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt(
      { genderGreeting: 'Bunda' } as any,
      true
    );
    expect(prompt).toContain('PERTANYAAN ALOKASI TENAGA BIDAN');
    expect(prompt).toContain('1 Bidan profesional kami yang sama');
    expect(prompt).toContain('PERTANYAAN DEFINISI / CAKUPAN PIJAT TERAPI');
    expect(prompt).toContain('DILARANG menolak atau langsung menurunkan ke Pijat Ceria');
  });

  it('"kalau sekarang apakah bisa ?" -> intent ask_schedule (audit 315036)', () => {
    expect(extractFastIntents('kalau sekarang apakah bisa ?')).toContain('ask_schedule');
  });
});
