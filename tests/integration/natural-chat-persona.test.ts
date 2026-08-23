import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeHallucinatedTerms,
  sanitizeRepetitiveGreetings,
} from '../../src/utils/language-sanitizer';
import { llmResponseGenerator } from '../../src/integrations/llm/generator';

describe('Natural Chat Persona & Exploratory Opener Tests', () => {
  describe('Language Sanitizer Improvements', () => {
    it('fixes brand name typo "Kala Moms and bayi Spa" to "Kala Moms and Baby Spa"', () => {
      const raw = 'seluruh treatment di Kala Moms and bayi Spa dilakukan oleh bidan bersertifikat.';
      const cleaned = sanitizeHallucinatedTerms(raw);
      expect(cleaned).toContain('Kala Moms and Baby Spa');
      expect(cleaned).not.toContain('bayi Spa');
    });

    it('fixes awkward "maupun Bund", "untuk Bund", "ke Bund" to "Bunda"', () => {
      const raw = 'Sudah terlatih dan paham banget kebutuhan si kecil maupun Bund.';
      const cleaned = sanitizeHallucinatedTerms(raw);
      expect(cleaned).toContain('maupun Bunda');
      expect(cleaned).not.toMatch(/\bmaupun\s+Bund\b/i);
    });

    it('reduces repetitive "Bunda" occurrences in a single response', () => {
      const raw = 'Benar sekali Bunda, seluruh treatment dilakukan oleh bidan ya, Bunda. Sudah terlatih dan paham banget kebutuhan si kecil maupun Bund. Kalau boleh tahu rumahnya di mana ya Bunda? Biar sekalian kami bantu cekkan ketersediaan bidan & ongkir ke tempat Bunda 😊';
      const cleaned = sanitizeRepetitiveGreetings(sanitizeHallucinatedTerms(raw));
      
      expect(cleaned).toContain('maupun Bunda');
      expect(cleaned).toContain('ketersediaan bidan & ongkirnya');
      expect(cleaned).not.toContain('ongkir ke tempat Bunda');
    });
  });

  describe('Exploratory Opener Simulation', () => {
    it('generates an inviting, non-closing response for exploratory questions', async () => {
      // Mock generateAnswer from llmResponseGenerator
      const mockLlmReply = {
        answer: 'Tentu boleh sekali, Bunda! 😊 Mau tanya seputar perawatan apa untuk si kecil atau Bunda? Silakan, saya siap bantu jelaskan yaa 🤗',
        reasoning: 'Customer asks permission to consult, warmly invite and ask what they need.',
      };

      vi.spyOn(llmResponseGenerator, 'generateFaqResponseWithDetails').mockResolvedValue(mockLlmReply as any);

      const result = await llmResponseGenerator.generateFaqResponseWithDetails(
        'Permisi, mau tanya-tanya dulu boleh?',
        [],
        'conv_test_1',
        'default-tenant',
        undefined,
        'cust_123',
        true
      );

      expect(result.answer).toContain('Tentu boleh');
      expect(result.answer).not.toContain('diskusikan dulu bersama keluarga');
      expect(result.answer).not.toContain('kami tunggu kabar');
    });
  });
});
