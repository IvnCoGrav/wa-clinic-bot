import { describe, it, expect } from 'vitest';
import { checkPolicyInquiry } from '../../src/state-machine/utils/policy-checker';
import { isAskPrice, buildPolicyAnswer } from '../../src/services/price-answer.service';

describe('Phase 2: Policy & Clarification Q&A Engine', () => {
  describe('Task 2.1: checkPolicyInquiry Detection', () => {
    const ongkirInclusionPhrases = [
      'brrti blm termasuk ongkir yaaaa',
      'itu sudah sama ongkir belum kak?',
      'harga di atas sudah termasuk ongkir?',
      'belum termasuk ongkir ya?',
      'ongkirnya bayar terpisah ya?',
      'ongkirnya bayar lagi?',
      'include ongkir ga ya?',
      'ongkir bayar sendiri ya?',
      'harga segitu udah plus ongkir blm?',
      'exclude ongkir ya bund?',
    ];

    ongkirInclusionPhrases.forEach((text) => {
      it(`should recognize ONGKIR_INCLUSION policy query: "${text}"`, () => {
        const type = checkPolicyInquiry(text);
        expect(type).toBe('ONGKIR_INCLUSION');
      });
    });

    const paymentPhrases = [
      'bisa transfer?',
      'bayar di tempat bisa?',
      'bisa bayar cash atau transfer?',
      'ada qris gak kak?',
      'sistem pembayarannya gimana ya?',
      'bayar dp dulu atau setelah selesai?',
      'bisa cod ga?',
      'ada rekening bca?',
    ];

    paymentPhrases.forEach((text) => {
      it(`should recognize PAYMENT_METHOD policy query: "${text}"`, () => {
        const type = checkPolicyInquiry(text);
        expect(type).toBe('PAYMENT_METHOD');
      });
    });

    const therapistPhrases = [
      'apakah terapisnya bidan?',
      'yang datang bidan asli kan?',
      'terapisnya bersertifikat?',
      'bidannya punya str?',
      'apakah perawat atau bidan?',
    ];

    therapistPhrases.forEach((text) => {
      it(`should recognize THERAPIST_QUALIFICATION policy query: "${text}"`, () => {
        const type = checkPolicyInquiry(text);
        expect(type).toBe('THERAPIST_QUALIFICATION');
      });
    });

    const coveragePhrases = [
      'melayani daerah mana saja?',
      'daerah mana aja yang tercover?',
      'homecare nya sampai mana saja?',
      'sidoarjo mana aja yang bisa?',
    ];

    coveragePhrases.forEach((text) => {
      it(`should recognize COVERAGE_AREA policy query: "${text}"`, () => {
        const type = checkPolicyInquiry(text);
        expect(type).toBe('COVERAGE_AREA');
      });
    });

    const multiChildPhrases = [
      'kalau untuk 2 anak ongkirnya dihitung 2x atau 1x?',
      'ongkirnya per anak atau per alamat?',
      'kalau bunda sama bayi transportnya bayar 1x kan?',
    ];

    multiChildPhrases.forEach((text) => {
      it(`should recognize MULTI_CHILD_TRANSPORT policy query: "${text}"`, () => {
        const type = checkPolicyInquiry(text);
        expect(type).toBe('MULTI_CHILD_TRANSPORT');
      });
    });
  });

  describe('Task 2.2: Price Hijacking Prevention (isAskPrice Isolation)', () => {
    const policyPhrasesThatMustNotHijackPrice = [
      'brrti blm termasuk ongkir yaaaa',
      'itu sudah sama ongkir belum kak?',
      'bisa transfer?',
      'terapisnya bidan asli kan?',
      'kalau 2 anak ongkirnya 1x kan?',
    ];

    policyPhrasesThatMustNotHijackPrice.forEach((text) => {
      it(`should return FALSE for isAskPrice on policy query: "${text}"`, () => {
        const result = isAskPrice(text);
        expect(result).toBe(false);
      });
    });

    const genuinePriceQuestions = [
      'pijat bayi berapa ya harganya?',
      'ongkir ke waru berapa?',
      'paket newborn tarifnya berapa?',
    ];

    genuinePriceQuestions.forEach((text) => {
      it(`should return TRUE for isAskPrice on genuine price query: "${text}"`, () => {
        const result = isAskPrice(text);
        expect(result).toBe(true);
      });
    });
  });

  describe('Task 2.3: buildPolicyAnswer Contextual Generation', () => {
    it('should generate contextual ongkir inclusion answer when customer location is known', () => {
      const reply = buildPolicyAnswer('ONGKIR_INCLUSION', {
        kelurahan: 'Rungkut Kidul',
        ongkir: 15000,
      });
      expect(reply).toContain('Rungkut Kidul');
      expect(reply).toContain('15.000');
      expect(reply).toContain('belum termasuk ongkir');
    });

    it('should generate prompt for location when customer location is unknown', () => {
      const reply = buildPolicyAnswer('ONGKIR_INCLUSION');
      expect(reply).toContain('belum termasuk');
      expect(reply).toContain('Waru');
      expect(reply).toContain('kelurahan');
    });

    it('should generate payment method policy answer mentioning transfer, QRIS, and cash', () => {
      const reply = buildPolicyAnswer('PAYMENT_METHOD');
      expect(reply).toContain('Transfer Bank');
      expect(reply).toContain('QRIS');
      expect(reply).toContain('Cash');
    });

    it('should generate therapist qualification answer mentioning certified Bidan and STR', () => {
      const reply = buildPolicyAnswer('THERAPIST_QUALIFICATION');
      expect(reply).toContain('Bidan Resmi');
      expect(reply).toContain('STR');
    });
  });
});
