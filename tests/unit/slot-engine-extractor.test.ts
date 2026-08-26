import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityExtractor } from '../../src/slot-engine/entity-extractor';
import * as modelFallback from '../../src/integrations/llm/model-fallback';

describe('Unified Single-Pass Semantic Extractor (Part 3)', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test_key_123';
    process.env.LLM_API_KEY = 'test_key_123';
  });

  describe('preExtractDeterministic (Stage 1 Fast Pre-Extractor)', () => {
    it('should pre-extract native WhatsApp GPS coordinates', () => {
      const result = EntityExtractor.preExtractDeterministic('', {
        type: 'location',
        location: { latitude: -7.281, longitude: 112.684 },
      });

      expect(result.locationText).toBe('-7.281,112.684');
      expect(result.intents).toContain('provide_location');
    });

    it('should parse explicit ages in months without LLM call', () => {
      const res1 = EntityExtractor.preExtractDeterministic('Anak saya usia 2 bulan');
      expect(res1.childAgeMonths).toBe(2);

      const res2 = EntityExtractor.preExtractDeterministic('bayi 1 tahun');
      expect(res2.childAgeMonths).toBe(12);

      const res3 = EntityExtractor.preExtractDeterministic('anak 3 thn');
      expect(res3.childAgeMonths).toBe(36);
    });

    it('should instantly flag medical emergencies', () => {
      const res = EntityExtractor.preExtractDeterministic('Tolong bidan anak saya kejang dan tidak sadar');
      expect(res.isMedicalEmergency).toBe(true);
      expect(res.intents).toContain('medical_emergency');
    });

    it('should recognize clinic origin inquiry and short affirmations', () => {
      const resOrigin = EntityExtractor.preExtractDeterministic('Bidan ini dari daerah mana ya?');
      expect(resOrigin.intents).toContain('ask_clinic_origin');

      const resAffirm = EntityExtractor.preExtractDeterministic('Boleh bund');
      expect(resAffirm.intents).toContain('affirmation');
    });
  });

  describe('extract (Stage 2 Unified LLM Extraction)', () => {
    it('should parse multi-intent compound message with mocked LLM response', async () => {
      vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValueOnce({
        model: 'MiniMax-M2.7-highspeed',
        baseUrl: 'https://api.sumopod.com',
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intents: ['provide_location', 'provide_age', 'consult_symptom', 'ask_price'],
                  location_text: 'Pradah Kali Kendal',
                  street_detail: 'Darmo permai selatan gang 17',
                  child_age_months: 2,
                  symptoms: ['grok-grok'],
                  treatment_referenced: null,
                  preferred_date_text: null,
                  preferred_time_text: null,
                  customer_name: null,
                  is_medical_emergency: false,
                  confidence_score: 0.95,
                }),
              },
            },
          ],
        },
      } as any);

      const result = await EntityExtractor.extract(
        'Rumah saya di Pradah Kali Kendal gang 17, anak saya 2 bulan grok-grok mau tanya harga paketnya',
        { customerPhone: '6288235780925' }
      );

      expect(result.locationText).toBe('Pradah Kali Kendal');
      expect(result.streetDetail).toBe('Darmo permai selatan gang 17');
      expect(result.childAgeMonths).toBe(2);
      expect(result.symptoms).toContain('grok-grok');
      expect(result.intents).toContain('provide_location');
      expect(result.intents).toContain('consult_symptom');
      expect(result.intents).toContain('ask_price');
    });

    it('should gracefully fallback to deterministic pre-extractor when LLM throws error', async () => {
      vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockRejectedValueOnce(
        new Error('Network timeout')
      );

      const result = await EntityExtractor.extract('Anak saya usia 5 bulan batuk', {
        customerPhone: '6288235780925',
      });

      expect(result.childAgeMonths).toBe(5);
      expect(result.confidenceScore).toBe(0.8);
    });
  });
});
