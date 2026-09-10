import { describe, it, expect } from 'vitest';
import { V3AgentRunner } from '../../../src/v3/agent/agent-runner';
import { PersonaPromptBuilder } from '../../../src/v3/agent/persona';
import { executeGetClinicFaq } from '../../../src/v3/tools/clinic-faq.tool';

/**
 * Phase 1+5 (audit 222655) — adversarial vaccine safety: slang imunisasi
 * selalu ter-grounding SOP pasca-vaksin, TIDAK pernah tercatut artikel mandi.
 */
describe('Vaccine Safety Guardrails', () => {
  it('slang imunisasi terdeteksi sinyal vaksin', () => {
    expect(V3AgentRunner.hasVaccineSignal('enaknya pijat e itu habis imunisasi apa sebelum e ya kak?')).toBe(true);
    expect(V3AgentRunner.hasVaccineSignal('anak habis suntik boleh langsung dipijat?')).toBe(true);
    expect(V3AgentRunner.hasVaccineSignal('kapan boleh pijat setelah vaksin bcg?')).toBe(true);
  });

  it('non-vaksin TIDAK terdeteksi (suntik KB dewasa, sapaan)', () => {
    expect(V3AgentRunner.hasVaccineSignal('suntik KB boleh pijat?')).toBe(false);
    expect(V3AgentRunner.hasVaccineSignal('halo kak selamat pagi')).toBe(false);
    expect(V3AgentRunner.hasVaccineSignal('harganya berapa ya?')).toBe(false);
  });

  it('slang imunisasi memicu pre-grounding RAG', () => {
    expect(V3AgentRunner.isSubstantiveForPreGrounding('enaknya pijat e itu habis imunisasi apa sebelum e ya kak?')).toBe(true);
    expect(V3AgentRunner.isSubstantiveForPreGrounding('anak habis suntik kipi demam boleh pijat?')).toBe(true);
  });

  it('persona: guardrail vaksin mutlak + imunisasi BUKAN layanan-luar-katalog', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('ATURAN VAKSINASI & IMUNISASI');
    expect(prompt).toContain('DILARANG KERAS menyamakan imunisasi dengan mandi');
    expect(prompt).not.toContain('tindik telinga, imunisasi, sunat');
  });

  it('policy tool post_vaccine_rules: jeda 3 hari, tanpa klaim "setelah imunisasi"', async () => {
    const out = await executeGetClinicFaq({ topic: 'post_vaccine_rules' } as any);
    expect(out.factualSummary).toMatch(/3 hari/i);
    expect(out.suggestedReply).not.toMatch(/sebaiknya pijat (dilakukan )?setelah imunisasi/i);
  });

  it('RAG in-memory: query slang me-retrieve artikel vaksin (bukan mandi)', async () => {
    const { knowledgeBaseService } = await import('../../../src/services/knowledge.service');
    await knowledgeBaseService.addFaqItem({
      tenantId: 'default-tenant',
      category: 'MEDIS',
      question: 'Apakah bayi yang baru saja divaksin / imunisasi boleh langsung dipijat?',
      answer: 'Setelah vaksin atau imunisasi, si kecil sebaiknya diistirahatkan selama 2–3 hari terlebih dahulu sebelum dipijat, Bunda.',
      keywords: 'vaksin, vaksinasi, imunisasi, suntik, dpt, bcg, polio, habis vaksin, kipi, demam',
    });
    const chunks = await knowledgeBaseService.searchRelevantChunks(
      'enaknya pijat e itu habis imunisasi apa sebelum e ya kak?',
      3,
      'default-tenant'
    );
    expect(chunks.some((c: any) => `${c.title} ${c.content}`.toLowerCase().includes('2–3 hari'))).toBe(true);
  });
});
