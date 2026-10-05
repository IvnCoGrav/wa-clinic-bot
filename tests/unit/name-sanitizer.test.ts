import { describe, it, expect, beforeAll } from 'vitest';
import {
  sanitizeCustomerNameForGreeting,
  sanitizeCustomerNameForStorage,
  formatGreetingBunda,
  cleanSingleBabyName,
  formatBabyNamesForGreeting,
} from '../../src/utils/name-sanitizer';
import { getRollingFollowUpMessage } from '../../src/config/followup-templates';
import { getGazetteerAreas } from '../../src/utils/gazetteer';

describe('Name & BabyName Sanitizer Unit Tests', () => {
  beforeAll(() => {
    // Trigger boot wiring: gazetteer menginjeksi leksikon distrik data-driven
    // ke name-sanitizer (single source = dataset).
    getGazetteerAreas();
  });

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

    it('removes Semampir district from "Bunda Hera Semampir" and "Hera Semampir"', () => {
      expect(sanitizeCustomerNameForGreeting('Bunda Hera Semampir')).toBe('Hera');
      expect(sanitizeCustomerNameForGreeting('Hera Semampir')).toBe('Hera');
      expect(formatGreetingBunda(sanitizeCustomerNameForGreeting('Bunda Hera Semampir'))).toBe('Bunda Hera');
    });

    it('removes complex district and separator combinations', () => {
      expect(sanitizeCustomerNameForGreeting('Bunda Iren, Sarirogo')).toBe('Iren');
      expect(sanitizeCustomerNameForGreeting('Bunda Maya - Semampir')).toBe('Maya');
      expect(sanitizeCustomerNameForGreeting('Bunda Nia Medokan Semampir')).toBe('Nia');
      expect(sanitizeCustomerNameForGreeting('Bunda Siska dari Sukolilo')).toBe('Siska');
      expect(sanitizeCustomerNameForGreeting('Bunda Anita Semampir Sidoarjo')).toBe('Anita');
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

    it('collapses duplicate contact-name tokens from Google/WA contact sync', () => {
      expect(sanitizeCustomerNameForGreeting('Bunda Ifa Tambak Os Tambak Os')).toBe('Ifa');
      expect(sanitizeCustomerNameForGreeting('Bunda Karimah Sedati Sedati')).toBe('Karimah');
      expect(sanitizeCustomerNameForGreeting('Bunda Mutia Gunung Anyar Tambak Gunung Anyar Tambak')).toBe('Mutia');
    });

    it('collapses duplicated location phrase NOT in static list (data-driven)', () => {
      expect(sanitizeCustomerNameForGreeting('Bunda Ifa Gisik Cemandi Gisik Cemandi')).toBe('Ifa');
    });

    it('does not mangle a real name that legitimately repeats a single word', () => {
      expect(sanitizeCustomerNameForGreeting('Bunda Dede Dede')).toBe('Dede Dede');
    });
  });

  // Adversarial (mandat anti-overfitting): bukan meniru 1 kalimat verbatim,
  // tetapi variasi parafrase singkatan/besar-kecil/dialek wilayah yang tak terbatas.
  describe('1b. sanitizeCustomerNameForGreeting — kebocoran singkatan & toponimi', () => {
    it('membuang singkatan "Kec."/"Kel." berpasangan dengan toponimi', () => {
      expect(sanitizeCustomerNameForGreeting('Bunda Dewy Kec. Sawahan kota Surabaya')).toBe('Dewy');
      expect(sanitizeCustomerNameForGreeting('Bunda Dewy KEC SAWAHAN')).toBe('Dewy');
      expect(sanitizeCustomerNameForGreeting('Bunda Dewy kecamatan sawahan')).toBe('Dewy');
      expect(sanitizeCustomerNameForGreeting('Bunda Dewy Kel. Sawahan')).toBe('Dewy');
    });

    it('membuang toponimi ganda beruntun tanpa mutilasi tengah kalimat', () => {
      expect(sanitizeCustomerNameForGreeting('Bunda ella Kecamatan Waru Kecamatan Waru')).toBe('ella');
      expect(sanitizeCustomerNameForGreeting('Bunda Ayu menganti Kecamatan Menganti Kecamatan Menganti')).toBe('Ayu');
      expect(sanitizeCustomerNameForGreeting('Bunda chaterina Kecamatan Sedati')).toBe('chaterina');
      expect(sanitizeCustomerNameForGreeting('Bunda Olivia G Sedati')).toBe('Olivia G');
    });

    it('membuang toponimi di tengah nama', () => {
      expect(sanitizeCustomerNameForGreeting('Bunda Jasmine Lontar Sambikerep')).toBe('Jasmine');
    });

    it('tidak merusak nama yang mengandung konjungsi toponimi', () => {
      expect(sanitizeCustomerNameForGreeting('Pak alip buduran & sidoarjo')).toBe('Pak alip');
    });
  });

  // Gerbang SEAM TULIS: DB menyimpan prefix "Bunda" & nama utuh, tetapi TANPA noise wilayah.
  describe('1c. sanitizeCustomerNameForStorage (gerbang persistensi)', () => {
    it('mempertahankan prefix Bunda dan membuang noise wilayah', () => {
      expect(sanitizeCustomerNameForStorage('Bunda Dewy Kec. Sawahan kota Surabaya')).toBe('Bunda Dewy');
      expect(sanitizeCustomerNameForStorage('Bunda ella Kecamatan Waru Kecamatan Waru')).toBe('Bunda ella');
      expect(sanitizeCustomerNameForStorage('Bunda Jasmine Lontar Sambikerep')).toBe('Bunda Jasmine');
      expect(sanitizeCustomerNameForStorage('Bunda Retno Gedangan')).toBe('Bunda Retno');
      expect(sanitizeCustomerNameForStorage('Bunda Rina, Sidotopo Wetan')).toBe('Bunda Rina');
    });

    it('tidak menyentuh nama bersih (anti-mutilasi)', () => {
      expect(sanitizeCustomerNameForStorage('Bunda Sari')).toBe('Bunda Sari');
      expect(sanitizeCustomerNameForStorage('Bunda Fitria Febriani')).toBe('Bunda Fitria Febriani');
    });

    it('mengembalikan string kosong untuk placeholder (pemanggil wajib skip tulis)', () => {
      expect(sanitizeCustomerNameForStorage('Bunda')).toBe('');
      expect(sanitizeCustomerNameForStorage('')).toBe('');
      expect(sanitizeCustomerNameForStorage(null)).toBe('');
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
