import { describe, it, expect } from 'vitest';
import { V3AgentRunner } from '../../../src/v3/agent/agent-runner';
import { PersonaPromptBuilder } from '../../../src/v3/agent/persona';
import { resolveChunkKeywords } from '../../../src/services/keyword-enrichment.service';

/**
 * Phase 1+5 (audit 337101) — pediatric fall safety: sinyal trauma, RAG SOP,
 * guardrail persona. Tanpa DB (offline-safe, in-memory fallback).
 */
describe('Pediatric Fall Trauma Safety', () => {
  it('varian bahasa jatuh terdeteksi sinyal trauma', () => {
    expect(V3AgentRunner.hasFallInjurySignal('kemarin anak saya baru jatuh, itu bisa nggak ya')).toBe(true);
    expect(V3AgentRunner.hasFallInjurySignal('si kecil kejedot meja semalam')).toBe(true);
    expect(V3AgentRunner.hasFallInjurySignal('habis jatuh dari kasur')).toBe(true);
    expect(V3AgentRunner.hasFallInjurySignal('bayinya terbentur pintu')).toBe(true);
  });

  it('non-trauma TIDAK terdeteksi (sapaan, harga, jadwal)', () => {
    expect(V3AgentRunner.hasFallInjurySignal('halo kak selamat pagi')).toBe(false);
    expect(V3AgentRunner.hasFallInjurySignal('harganya berapa ya?')).toBe(false);
    expect(V3AgentRunner.hasFallInjurySignal('untuk jumat besok apakah bisa?')).toBe(false);
  });

  it('query jatuh memicu pre-grounding RAG', () => {
    expect(V3AgentRunner.isSubstantiveForPreGrounding('kemarin anak saya baru jatuh, itu bisa nggak ya')).toBe(true);
  });

  it('judul SOP jatuh ter-resolve ke keywords skrining', () => {
    const kw = resolveChunkKeywords(
      'Apakah bayi yang baru jatuh atau terbentur boleh langsung dipijat?',
      null
    );
    expect(kw).not.toBeNull();
    for (const w of ['benjolan', 'dilarang pijat', 'observasi 24 jam']) {
      expect(kw!).toContain(w);
    }
  });

  it('RAG in-memory: query jatuh me-retrieve SOP skrining (red flags)', async () => {
    const { knowledgeBaseService } = await import('../../../src/services/knowledge.service');
    await knowledgeBaseService.addFaqItem({
      tenantId: 'default-tenant',
      category: 'MEDIS',
      question: 'Apakah bayi yang baru jatuh atau terbentur boleh langsung dipijat?',
      answer: 'TANDA BAHAYA (PIJAT DILARANG MUTLAK): benjolan, muntah menyembur. SYARAT PIJAT AMAN: observasi minimal 24 jam.',
      keywords: 'jatuh, kejedot, bentur, benjol, muntah menyembur, observasi 24 jam, dilarang pijat',
    });
    const chunks = await knowledgeBaseService.searchRelevantChunks(
      'kemarin anak saya baru jatuh, itu bisa nggak ya',
      3,
      'default-tenant'
    );
    expect(chunks.some((c: any) => `${c.title} ${c.content}`.toLowerCase().includes('dilarang mutlak'))).toBe(true);
  });

  it('persona: skrining red flags + larangan tawar jadwal langsung', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('SKRINING MEDIS BAYI JATUH');
    expect(prompt).toContain('muntah');
    expect(prompt).toContain('DILARANG langsung menawarkan jadwal pijat');
    expect(prompt).toContain('PIJAT DILARANG MUTLAK');
  });
});
