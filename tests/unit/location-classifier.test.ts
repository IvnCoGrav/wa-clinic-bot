import { describe, it, expect } from 'vitest';
import { isClinicLocationQuestion, QUESTION_LEAD_RE } from '../../src/utils/location-classifier';

describe('Location Classifier - isClinicLocationQuestion (Fase 4-1)', () => {
  describe('Kasus Positif: Pertanyaan Lokasi/Alamat Klinik', () => {
    const positiveCases = [
      'lokasinya dimana ya',
      'tanya alamat klinik',
      'di mana tempatnya',
      'dimana kliniknya ya kak',
      'dimana ya min',
      'apa alamat kliniknya?',
      'apakah ada kliniknya bunda?',
      'sebelah mana ya lokasinya',
      'mau tanya lokasi mombykids',
      'pengen tanya alamat kliniknya',
      'nanya tempat kliniknya dimana',
      'alamatnya di mana bunda',
      'klinik nya dmana ya kak',
      'lokasi nya mn kak',
      'dimana yg di surabaya?',
      'yang mana alamat kliniknya'
    ];

    for (const text of positiveCases) {
      it(`mendeteksi pertanyaan lokasi: "${text}"`, () => {
        expect(isClinicLocationQuestion(text)).toBe(true);
      });
    }
  });

  describe('Kasus Negatif: Alamat Rumah Customer / Non-Pertanyaan Lokasi', () => {
    const negativeCases = [
      'saya di rungkut',
      'rumah saya di rungkut menanggal no 15',
      'posisi di alana tambak oso waru',
      'alamat saya jl ahmad yani no 10 surabaya',
      'daerah tropodo sidoarjo kak',
      'anak saya demam bapil',
      'mau booking pijat bayi untuk besok',
      'tertarik promo massage bunda',
      'terima kasih infonya',
      'iya betul',
      'bisa homecare ke perumahan delta sari?'
    ];

    for (const text of negativeCases) {
      it(`TIDAK mendeteksi alamat tinggal/pesan umum sebagai tanya lokasi klinik: "${text}"`, () => {
        expect(isClinicLocationQuestion(text)).toBe(false);
      });
    }
  });

  describe('Edge Cases / Ketahanan Nilai Abnormal', () => {
    it('mengembalikan false untuk string kosong atau whitespace', () => {
      expect(isClinicLocationQuestion('')).toBe(false);
      expect(isClinicLocationQuestion('   ')).toBe(false);
    });

    it('mengembalikan false secara aman untuk tipe data non-string', () => {
      expect(isClinicLocationQuestion(null as any)).toBe(false);
      expect(isClinicLocationQuestion(undefined as any)).toBe(false);
      expect(isClinicLocationQuestion(12345 as any)).toBe(false);
      expect(isClinicLocationQuestion({} as any)).toBe(false);
    });

    it('QUESTION_LEAD_RE regex dapat dipakai secara independen', () => {
      expect(QUESTION_LEAD_RE.test('dimana')).toBe(true);
      expect(QUESTION_LEAD_RE.test('di mana')).toBe(true);
      expect(QUESTION_LEAD_RE.test('rungkut')).toBe(false);
    });

    it('re-export kompatibilitas dari entity-extractor.service berfungsi identik', async () => {
      const { isClinicLocationQuestion: fromExtractor } = await import('../../src/services/entity-extractor.service');
      expect(fromExtractor('lokasinya dimana ya')).toBe(true);
      expect(fromExtractor('saya di rungkut')).toBe(false);
    });
  });
});
