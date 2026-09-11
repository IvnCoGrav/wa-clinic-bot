import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityExtractor } from '../../src/services/entity-extractor.service';
import * as modelFallback from '../../src/integrations/llm/model-fallback';

/**
 * Mekanisme A — Batas domain NLU: intent "out_of_domain" untuk pertanyaan
 * substantif yang tidak ter-grounding ke katalog/KB/kebijakan klinik.
 * Anti-tambal-sulam: TIDAK ada string topik-insiden ("loker") di runtime src/;
 * kelas didefinisikan prinsipil + seed generik + contoh negatif anti-false-positive.
 */
describe('Out-of-Domain Intent (batas domain NLU)', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test_key_123';
    process.env.LLM_API_KEY = 'test_key_123';
    vi.restoreAllMocks();
  });

  describe('preExtractDeterministic — tidak boleh menebak jadwal/unlisted untuk topik asing', () => {
    it.each([
      'Pagi kak mau tanya lokernya masih tersedia ?',
      'Lokernya masih tersedia kak ?',
      'Mau tanya, ada info kos dekat sini?',
      'Kak jual stroller bekas tidak?',
    ])('"%s" → bukan ask_schedule / ask_unlisted_service / provide_location', (text) => {
      const r = EntityExtractor.preExtractDeterministic(text);
      expect(r.intents || []).not.toContain('ask_schedule');
      expect(r.intents || []).not.toContain('ask_unlisted_service');
      expect(r.intents || []).not.toContain('provide_location');
    });

    it('kontrol jadwal tidak dibajak ke unlisted', () => {
      const r = EntityExtractor.preExtractDeterministic('Besok masih ada slot kosong?');
      expect(r.intents || []).not.toContain('ask_unlisted_service');
      expect(r.intents || []).not.toContain('provide_location');
    });
  });

  describe('extract (LLM) — out_of_domain lolos pipeline taksonomi', () => {
    function mockLlmIntents(intents: string[]) {
      vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValueOnce({
        model: 'mock-model',
        baseUrl: 'https://mock.api',
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intents,
                  location_text: null,
                  comparison_locations: null,
                  street_detail: null,
                  child_age_months: null,
                  symptoms: [],
                  treatment_referenced: null,
                  preferred_date_text: null,
                  preferred_time_text: null,
                  customer_name: null,
                  is_medical_emergency: false,
                  confidence_score: 0.9,
                }),
              },
            },
          ],
        },
      } as any);
    }

    it('intents ["out_of_domain"] dari LLM dipertahankan (tidak di-strip sanitizer)', async () => {
      mockLlmIntents(['out_of_domain']);
      const result = await EntityExtractor.extract('Mau tanya, ada info kos dekat sini?', {
        customerPhone: '6289000000001',
      });
      expect(result.intents).toContain('out_of_domain');
    });

    it('kontrol: ["ask_schedule"] tetap lolos untuk pertanyaan slot', async () => {
      mockLlmIntents(['ask_schedule']);
      const result = await EntityExtractor.extract('Besok masih ada slot kosong?', {
        customerPhone: '6289000000002',
      });
      expect(result.intents).toContain('ask_schedule');
      expect(result.intents).not.toContain('out_of_domain');
    });
  });
});
