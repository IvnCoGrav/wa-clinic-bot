import { describe, it, expect } from 'vitest';
import {
  sanitizeCustomerNameForGreeting,
  formatGreetingBunda,
  cleanSingleBabyName,
  formatBabyNamesForGreeting,
} from '../../src/utils/name-sanitizer';
import { getRollingFollowUpMessage } from '../../src/config/followup-templates';

describe('Name & BabyName Sanitizer Unit Tests', () => {
  describe('1. sanitizeCustomerNameForGreeting', () => {
    it('removes "Bunda" prefix and district suffix from "Bunda Rina Kecamatan Sukodono"', () => {
      expect(sanitizeCustomerNameForGreeting('Bunda Rina Kecamatan Sukodono')).toBe('Rina');
    });

    it('removes trailing Surabaya district from "Viska rungkut"', () => {
      expect(sanitizeCustomerNameForGreeting('Viska rungkut')).toBe('Viska');
    });

    it('removes prefix and district from "Bunda Karimah Sedati"', () => {
      expect(sanitizeCustomerNameForGreeting('Bunda Karimah Sedati')).toBe('Karimah');
    });

    it('removes address after comma from "Bunda Balqis, Sidotopo Wetan"', () => {
      expect(sanitizeCustomerNameForGreeting('Bunda Balqis, Sidotopo Wetan')).toBe('Balqis');
    });

    it('removes "+ Alamat" note from "Fitria Febriani + Alamat"', () => {
      expect(sanitizeCustomerNameForGreeting('Fitria Febriani + Alamat')).toBe('Fitria Febriani');
    });

    it('removes multi-word district from "Deby Karang Pilang"', () => {
      expect(sanitizeCustomerNameForGreeting('Deby Karang Pilang')).toBe('Deby');
    });

    it('removes emojis and preserves name from "🇮🇩 Herman_Zhu 🇮🇩"', () => {
      expect(sanitizeCustomerNameForGreeting('🇮🇩 Herman_Zhu 🇮🇩')).toBe('Herman_Zhu');
    });

    it('removes WA status suffix from "Lili - Leave ur Chat-Busy"', () => {
      expect(sanitizeCustomerNameForGreeting('Lili - Leave ur Chat-Busy')).toBe('Lili');
    });

    it('returns empty string for standalone generic words / placeholders', () => {
      expect(sanitizeCustomerNameForGreeting('Bunda')).toBe('');
      expect(sanitizeCustomerNameForGreeting('~')).toBe('');
      expect(sanitizeCustomerNameForGreeting('Pelanggan 6319')).toBe('');
      expect(sanitizeCustomerNameForGreeting('Sandbox Customer')).toBe('');
      expect(sanitizeCustomerNameForGreeting('')).toBe('');
      expect(sanitizeCustomerNameForGreeting(null)).toBe('');
      expect(sanitizeCustomerNameForGreeting(undefined)).toBe('');
    });
  });

  describe('2. formatGreetingBunda', () => {
    it('returns "Bunda <Name>" when clean name is present', () => {
      expect(formatGreetingBunda('Rina')).toBe('Bunda Rina');
      expect(formatGreetingBunda('Viska')).toBe('Bunda Viska');
    });

    it('returns simply "Bunda" when name is empty or already "Bunda"', () => {
      expect(formatGreetingBunda('')).toBe('Bunda');
      expect(formatGreetingBunda('Bunda')).toBe('Bunda');
    });
  });

  describe('3. formatBabyNamesForGreeting (Single, Twins & Multi-Baby)', () => {
    it('returns "si kecil" when no children data exists', () => {
      expect(formatBabyNamesForGreeting([])).toBe('si kecil');
      expect(formatBabyNamesForGreeting(null)).toBe('si kecil');
    });

    it('formats single baby correctly', () => {
      const children = [{ name: 'Adek Kenzo (3 bulan)' }];
      expect(formatBabyNamesForGreeting(children)).toBe('Kenzo');
      expect(formatBabyNamesForGreeting(children, null, { prefixDek: true })).toBe('dek Kenzo');
    });

    it('formats 2 babies (twins) with "&" separator', () => {
      const children = [{ name: 'Adek Arka' }, { name: 'Adek Arki' }];
      expect(formatBabyNamesForGreeting(children)).toBe('Arka & Arki');
      expect(formatBabyNamesForGreeting(children, null, { prefixDek: true })).toBe('dek Arka & dek Arki');
    });

    it('formats 3+ babies with comma and "&"', () => {
      const children = [{ name: 'Kenzo' }, { name: 'Kenzie' }, { name: 'Kayla' }];
      expect(formatBabyNamesForGreeting(children)).toBe('Kenzo, Kenzie & Kayla');
      expect(formatBabyNamesForGreeting(children, null, { prefixDek: true })).toBe('dek Kenzo, dek Kenzie & dek Kayla');
    });

    it('extracts multiple babies from rawText when children array is empty', () => {
      const rawText = 'Nama Customer : Bunda Rina\nNama Bayi : Kenzo & Kenzie (6 bulan)\nAlamat : Rungkut';
      expect(formatBabyNamesForGreeting([], rawText)).toBe('Kenzo & Kenzie');
      expect(formatBabyNamesForGreeting([], rawText, { prefixDek: true })).toBe('dek Kenzo & dek Kenzie');
    });
  });

  describe('4. Rolling Follow-Up Templates Integration', () => {
    it('generates clean greeting without double "Bunda" for dirty contact name', () => {
      const { text } = getRollingFollowUpMessage('NO_PURCHASE_1', {
        name: 'Bunda Rina Kecamatan Sukodono',
        index: 0,
      });
      expect(text).toContain('Halo Bunda Rina!');
      expect(text).not.toContain('Bunda Bunda');
      expect(text).not.toContain('Sukodono');
    });

    it('generates clean greeting without trailing space when name is empty/generic', () => {
      const { text } = getRollingFollowUpMessage('NO_PURCHASE_1', {
        name: 'Sandbox Customer',
        index: 0,
      });
      expect(text).toContain('Halo Bunda!');
      expect(text).not.toContain('Bunda !');
      expect(text).not.toContain('Sandbox');
    });

    it('renders twins baby name cleanly in review template', () => {
      const { text } = getRollingFollowUpMessage('REVIEW_H1_BABY', {
        name: 'Bunda Balqis, Sidotopo Wetan',
        babyName: 'dek Arka & dek Arki',
        index: 0,
      });
      expect(text).toContain('Selamat pagi Bunda Balqis!');
      expect(text).toContain('dek Arka & dek Arki');
      expect(text).not.toContain('Bunda Bunda');
      expect(text).not.toContain('Sidotopo');
    });
  });
});
