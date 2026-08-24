import { describe, it, expect } from 'vitest';
import { isAskingClinicLocation } from '../../src/state-machine/utils/clinic-location-checker';

describe('Phase 4: Geocoding & Location Precision Defense', () => {
  describe('Task 4.1: Location Text Cleaning Regex Precision', () => {
    function cleanLocationInput(rawText: string): string {
      let text = rawText.toLowerCase()
        .replace(/^(halo|hola|hi|hei|p|assalamualaikum|salam|pagi|siang|sore|malam|permisi|kak|min|mbak|mas|bund|bunda)\b[,\.\s]*/gi, '')
        .replace(/^(?:berapa|brp)\s+(?:ongkir(?:nya)?|tarif(?:nya)?|biaya(?:nya)?|ongkos(?:nya)?)?\s*(?:kalau\s+|kalo\s+)?(?:ke|di)\s+/gi, '')
        .replace(/^(?:kalau\s+|kalo\s+)?(?:ke|di)\s+/gi, '')
        .replace(/^(?:alamat\s+|rumah\s+)?saya\s+(?:di|ke)\s+/gi, '')
        .replace(/^(?:ongkir|tarif|biaya|kirim|pengiriman)(?:nya)?\s+(?:ke|di)\s+/gi, '')
        .replace(/^(?:kelurahan|desa|kecamatan|kec)\s+/gi, '');

      text = text
        .replace(/[,.]?\s*(?:kena\s+)?(?:ongkir(?:nya)?|tarif(?:nya)?|biaya(?:nya)?|harga(?:nya)?|ongkos(?:nya)?)\s*(?:berapa|brp)?\s*[?.]*$/gi, '')
        .replace(/[,.]?\s*(?:berapa|brp)\s*(?:ya|yaa|bund|bunda|kak|ka|min|mbak|mas|gan|sis|dong|kah|\?|\s)*$/gi, '')
        .replace(/\s+(?:bund|bunda|ya|yaa|kak|ka|min|mbak|mas|gan|sis|dong|kah|\?)\b/gi, '')
        .replace(/\?/g, '')
        .trim();

      return text;
    }

    it('should correctly preserve location name when query starts with "Berapa ongkir ke..."', () => {
      const result = cleanLocationInput('Berapa ongkir ke Medokan Ayu?');
      expect(result).toBe('medokan ayu');
    });

    it('should correctly preserve location name when query starts with "Kalau ke..." and ends with "berapa ya"', () => {
      const result = cleanLocationInput('Kalau ke Waru berapa ya bund?');
      expect(result).toBe('waru');
    });

    it('should correctly preserve location name with kelurahan prefix', () => {
      const result = cleanLocationInput('Kelurahan Sedati Agung kak');
      expect(result).toBe('sedati agung');
    });

    it('should correctly preserve location name starting with P (Pakuwon / Pabean)', () => {
      const result1 = cleanLocationInput('Pakuwon City Mall');
      expect(result1).toBe('pakuwon city mall');

      const result2 = cleanLocationInput('Pabean Sedati');
      expect(result2).toBe('pabean sedati');
    });
  });

  describe('Task 4.2: Clinic Location Question Disambiguation', () => {
    const genuineClinicLocationQuestions = [
      'lokasi kliniknya dimana ya?',
      'kakaknya darimana kak?',
      'homebase nya dimana?',
      'alamat kantornya dimana?',
      'bidan dari mana ya?',
    ];

    genuineClinicLocationQuestions.forEach((text) => {
      it(`should recognize genuine clinic location inquiry: "${text}"`, () => {
        expect(isAskingClinicLocation(text)).toBe(true);
      });
    });

    const treatmentSelectionNotClinicLocation = [
      'treatment mana yang cocok buat anak 2 tahun?',
      'paket mana yang bagus untuk newborn?',
      'perawatan mana yang direkomendasikan?',
    ];

    treatmentSelectionNotClinicLocation.forEach((text) => {
      it(`should NOT misclassify treatment selection as clinic location inquiry: "${text}"`, () => {
        expect(isAskingClinicLocation(text)).toBe(false);
      });
    });
  });
});
