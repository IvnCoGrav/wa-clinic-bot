import { describe, it, expect } from 'vitest';
import { extractBalancedJson, repairTruncatedJson, extractJsonContent } from '../../src/utils/json-extract';

describe('json-extract: ekstraksi & perbaikan JSON output LLM', () => {
  describe('extractBalancedJson', () => {
    it('mengembalikan blok {..} balanced dari teks yang dibungkus kalimat', () => {
      const raw = 'Berikut hasilnya: {"intents": ["ask_price"], "entities": {}} Terima kasih!';
      const result = extractBalancedJson(raw, ['intents']);
      expect(result).toBe('{"intents": ["ask_price"], "entities": {}}');
    });

    it('tidak tertipu "}" di dalam string value', () => {
      const raw = '{"intents": ["complaint"], "entities": {"note": "katanya } ga jelas"}}';
      const result = extractBalancedJson(raw);
      expect(result).not.toBeNull();
      expect(JSON.parse(result as string).entities.note).toBe('katanya } ga jelas');
    });

    it('prefer blok yang mengandung preferredKey meski ada blok lain lebih dulu', () => {
      const raw = '{"conf": 0.9} lalu {"intents": ["greeting"], "entities": {}}';
      const result = extractBalancedJson(raw, ['intents']);
      expect(result).toContain('"intents"');
    });

    it('mengembalikan null jika tidak ada blok valid', () => {
      expect(extractBalancedJson('tidak ada json sama sekali')).toBeNull();
    });
  });

  describe('repairTruncatedJson', () => {
    it('menutup brace yang kurang ketika JSON terpotong di akhir', () => {
      const raw = '{"intents": ["ask_price"], "entities": {"preferred_date": "besok"';
      const result = repairTruncatedJson(raw);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result as string);
      expect(parsed.intents).toEqual(['ask_price']);
    });

    it('memotong progresif saat value terpotong di tengah', () => {
      const raw = '{"intents": ["greeting"], "entities": {}, "confidence": 0.9';
      const result = repairTruncatedJson(raw);
      expect(result).not.toBeNull();
      expect(JSON.parse(result as string).intents).toEqual(['greeting']);
    });

    it('mengembalikan null untuk teks tanpa brace pembuka', () => {
      expect(repairTruncatedJson('tidak ada json')).toBeNull();
    });
  });

  describe('extractJsonContent (pipeline lengkap)', () => {
    it('parses JSON utuh biasa', () => {
      const raw = '{"intents": ["faq_question"], "entities": {}}';
      expect(extractJsonContent(raw)).toBe(raw);
    });

    it('menangani code fence ```json ... ```', () => {
      const raw = '```json\n{"intents": ["negation"], "entities": {}}\n```';
      const result = extractJsonContent(raw, ['intents']);
      expect(JSON.parse(result as string).intents).toEqual(['negation']);
    });

    it('memulihkan JSON terpotong dari reasoning_content', () => {
      const raw = 'Jadi klasifikasinya adalah {"intents": ["express_interest"], "entities": {"treatment_name": "pijat bayi"}';
      const result = extractJsonContent(raw, ['intents']);
      expect(result).not.toBeNull();
      expect(JSON.parse(result as string).intents).toEqual(['express_interest']);
    });

    it('mengembalikan null untuk input non-JSON', () => {
      expect(extractJsonContent('halo bunda apa kabar')).toBeNull();
    });
  });
});