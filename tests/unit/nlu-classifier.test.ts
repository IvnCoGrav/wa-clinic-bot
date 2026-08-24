import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NluClassifierService } from '../../src/services/nlu-classifier.service';

describe('NLU Classifier Service Unit Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Fallback & Rule-based Matcher', () => {
    it('should classify greeting correctly via fallback rule matcher', async () => {
      const result = await NluClassifierService.classifyMessage('Halo min, selamat pagi', []);
      expect(result.intents).toContain('greeting');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('should classify provide_location and extract location_text entity', async () => {
      const result = await NluClassifierService.classifyMessage('Saya di kelurahan Ciwapan', []);
      expect(result.intents).toContain('provide_location');
      expect(result.entities?.location_text).toBe('kelurahan Ciwapan');
    });

    it('should classify price question (ask_price) correctly', async () => {
      const result = await NluClassifierService.classifyMessage('Berapa tarif pijat bayi?', []);
      expect(result.intents).toContain('ask_price');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('should classify price questions with suffix -nya and numbers like "hallo kak ini benar harganya 60rb saja" as ask_price', async () => {
      const result = await NluClassifierService.classifyMessage('hallo kak ini benar harganya 60rb saja', []);
      expect(result.intents).toContain('ask_price');
    });

    it('should classify treatment questions like "apakah yang treatment nanti bidan ya ?" as faq_question', async () => {
      const result = await NluClassifierService.classifyMessage('apakah yang treatment nanti bidan ya ?', []);
      expect(result.intents).toContain('faq_question');
      expect(result.intents).not.toContain('express_interest');
    });

    it('should classify clarification / anaphora "Maksud saya yang paket newborn" as faq_question', async () => {
      const result = await NluClassifierService.classifyMessage('Maksud saya yang paket newborn', []);
      expect(result.intents).toContain('faq_question');
      expect(result.entities?.treatment_name).toContain('newborn');
    });

    it('should classify affirmation & negation responses', async () => {
      const affirmRes = await NluClassifierService.classifyMessage('iya bener', []);
      expect(affirmRes.intents).toContain('affirmation');

      const negRes = await NluClassifierService.classifyMessage('bukan, salah alamat', []);
      expect(negRes.intents).toContain('negation');
    });

    it('should NOT falsely trigger greeting on words starting with P (e.g. Pakuwon, Pabean, Pijat)', async () => {
      const pakuwonRes = await NluClassifierService.classifyMessage('Pakuwon city mall', []);
      expect(pakuwonRes.intents).not.toContain('greeting');

      const pabeanRes = await NluClassifierService.classifyMessage('Pabean Sedati', []);
      expect(pabeanRes.intents).not.toContain('greeting');
    });

    it('should NOT falsely trigger negation on words starting with Ga (e.g. Gajah Mada, Gatot Subroto)', async () => {
      const gajahRes = await NluClassifierService.classifyMessage('Gajah Mada No 10', []);
      expect(gajahRes.intents).not.toContain('negation');

      const gatotRes = await NluClassifierService.classifyMessage('Gatot Subroto Blok A', []);
      expect(gatotRes.intents).not.toContain('negation');
    });

    it('should NOT falsely trigger affirmation on words starting with Ya/Ok/Siap (e.g. Yani, Oktober, Siaran)', async () => {
      const yaniRes = await NluClassifierService.classifyMessage('Yani mau booking treatment', []);
      expect(yaniRes.intents).not.toContain('affirmation');

      const oktoberRes = await NluClassifierService.classifyMessage('Oktober ada slot kosong?', []);
      expect(oktoberRes.intents).not.toContain('affirmation');
    });
  });

  describe('2. Multi-intent & Context Support', () => {
    it('should support message history context in classification', async () => {
      const contextHistory = [
        { role: 'assistant' as const, content: 'Halo Bunda, lokasi homecare-nya di mana?' },
        { role: 'user' as const, content: 'Kecamatan Coblong' },
      ];
      const result = await NluClassifierService.classifyMessage('berapa harganya ya kalau ke sana?', contextHistory);
      expect(result.intents).toContain('ask_price');
    });

    it('should return valid NLUResult structure with fallback flag when LLM fails or API key is not present', async () => {
      const result = await NluClassifierService.classifyMessage('Pijat laktasi berapa jam?', []);
      expect(result).toHaveProperty('intents');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('isFallback');
      expect(Array.isArray(result.intents)).toBe(true);
    });
  });
});
