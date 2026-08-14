import { describe, it, expect } from 'vitest';
import { checkMedicalKeywords } from '../../src/config/medical-keywords';
import { llmIntentService } from '../../src/integrations/llm/intent';
import { NluClassifierService } from '../../src/services/nlu-classifier.service';

/**
 * Fase 2 — Medical Detection Consolidation:
 * 1. Word boundary / segment-aware matching — keyword pendek tidak boleh
 *    false-positive match ke substring kata lain.
 * 2. Single source keyword medis (config/medical-keywords.ts) dipakai
 *    konsisten oleh intent.ts & nlu-classifier.service.ts.
 */
describe('Medical Detection — word boundary & single source', () => {
  it('keyword pendek TIDAK false-positive match ke kata lain ("kaku"/"kuning"/"step")', () => {
    // "kaku" di tengah "kakun" (nama) → TIDAK match
    expect(checkMedicalKeywords('kakun itu siapa ya').isMedical).toBe(false);
    // "kuning" di "kuningan" (nama daerah) → TIDAK match
    expect(checkMedicalKeywords('saya di kuningan jakarta').isMedical).toBe(false);
    // "step" di "step by step" (bahasa umum) → TIDAK match
    expect(checkMedicalKeywords('bisa dijelaskan step by step dong').isMedical).toBe(false);
  });

  it('keyword pendek tetap terdeteksi saat berdiri sendiri / dipisah spasi', () => {
    expect(checkMedicalKeywords('bayi saya kejang tadi malam').isMedical).toBe(true);
    expect(checkMedicalKeywords('badan kaku').isMedical).toBe(true);
    expect(checkMedicalKeywords('bayinya kuning').isMedical).toBe(true);
    expect(checkMedicalKeywords('anak saya step').isMedical).toBe(true);
  });

  it('multi-kata keyword tetap match sebagai substring (mis. "demam tinggi")', () => {
    const res = checkMedicalKeywords('anaknya demam tinggi sekali, mohon bantuannya');
    expect(res.isMedical).toBe(true);
    expect(res.severity).toBe('HIGH');
  });

  it('rule-based intent fallback memakai single source medical keywords', async () => {
    // Tanpa LLM key → fallback rule-based (intent.ts) jalan.
    const originalKey = process.env.LLM_API_KEY;
    process.env.LLM_API_KEY = 'mock_key';
    try {
      const res = await llmIntentService.detectIntent('anak saya demam tinggi, dikasih apa ya');
      expect(res.intent).toBe('medical_query');
    } finally {
      if (originalKey === undefined) delete process.env.LLM_API_KEY;
      else process.env.LLM_API_KEY = originalKey;
    }
  });

  it('NLU fallback mengklasifikasikan medical_query via single source', () => {
    const res = NluClassifierService.fallbackClassify('bayi saya mencret terus, bahaya ga ya?');
    expect(res.intents).toContain('medical_query');
    // Kata medis "kuningan" (daerah) tidak memicu medical_query di NLU fallback.
    const res2 = NluClassifierService.fallbackClassify('saya tinggal di kuningan jakarta, dekat mana ya');
    expect(res2.intents).not.toContain('medical_query');
  });
});
