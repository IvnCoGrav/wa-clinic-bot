import { describe, it, expect } from 'vitest';
import {
  maskPhoneNumber,
  maskPhoneInText,
  maskPhoneWithTenantSuffix
} from '../../src/utils/pii-masker';
import { maskPhone as capiMaskPhone } from '../../src/services/capi.service';
import { formatPhoneForReport } from '../../src/services/nightly-watchdog.service';

describe('PII Masker Consolidation (Fase 4-3 - Opsi A)', () => {
  describe('1. maskPhoneWithTenantSuffix (CAPI 4+4 Standard)', () => {
    it('menyensor nomor normal dengan format 4 depan + 4 bintang + 4 belakang', () => {
      expect(maskPhoneWithTenantSuffix('628123456789')).toBe('6281****6789');
      expect(maskPhoneWithTenantSuffix('081234567890')).toBe('0812****7890');
      expect(maskPhoneWithTenantSuffix('081299998888')).toBe('0812****8888');
    });

    it('mempertahankan suffix tenantId saat dipisahkan tanda titik dua (:)', () => {
      expect(maskPhoneWithTenantSuffix('628123456789:default-tenant')).toBe('6281****6789:default-tenant');
      expect(maskPhoneWithTenantSuffix('081234567890:klinik-cahaya')).toBe('0812****7890:klinik-cahaya');
    });

    it('menangani string dengan multi-colon secara rekursif', () => {
      expect(maskPhoneWithTenantSuffix('628123456789:tenant:extra')).toBe('6281****6789:tenant:extra');
    });

    it('menangani nomor pendek (5-7 digit) dengan 2+4+2', () => {
      expect(maskPhoneWithTenantSuffix('123456')).toBe('12****56');
      expect(maskPhoneWithTenantSuffix('1234567')).toBe('12****67');
    });

    it('menangani nomor sangat pendek (<= 4 digit) dengan **** penuh', () => {
      expect(maskPhoneWithTenantSuffix('1234')).toBe('****');
      expect(maskPhoneWithTenantSuffix('12')).toBe('****');
    });

    it('mengembalikan (no-phone) untuk nilai kosong/whitespace/null/undefined', () => {
      expect(maskPhoneWithTenantSuffix(null)).toBe('(no-phone)');
      expect(maskPhoneWithTenantSuffix(undefined)).toBe('(no-phone)');
      expect(maskPhoneWithTenantSuffix('')).toBe('(no-phone)');
      expect(maskPhoneWithTenantSuffix('   ')).toBe('(no-phone)');
    });

    it('re-export kompatibilitas dari capi.service berfungsi identik', () => {
      expect(capiMaskPhone('628123456789:default-tenant')).toBe('6281****6789:default-tenant');
      expect(capiMaskPhone(null)).toBe('(no-phone)');
    });
  });

  describe('2. maskPhoneNumber (Kanonis Log & Audit 4+3)', () => {
    it('menyensor nomor normal dengan format 4 depan + 4 bintang + 3 belakang', () => {
      expect(maskPhoneNumber('081234567890')).toBe('0812****890');
      expect(maskPhoneNumber('628123456789')).toBe('6281****789');
    });

    it('mengembalikan *** untuk nomor sangat pendek (<= 6 digit)', () => {
      expect(maskPhoneNumber('123456')).toBe('***');
      expect(maskPhoneNumber('1234')).toBe('***');
    });

    it('menangani nomor 7 digit dengan pola 4+****+3', () => {
      expect(maskPhoneNumber('1234567')).toBe('1234****567');
    });

    it('mengembalikan string kosong untuk nilai kosong atau non-string', () => {
      expect(maskPhoneNumber(null)).toBe('');
      expect(maskPhoneNumber(undefined)).toBe('');
      expect(maskPhoneNumber('')).toBe('');
      expect(maskPhoneNumber(12345 as any)).toBe('');
    });
  });

  describe('3. maskPhoneInText (Teks Bebas / Bubble Chat)', () => {
    it('menyensor 5 digit terakhir dalam kalimat WhatsApp', () => {
      expect(maskPhoneInText('hubungi 081234567890 ya')).toBe('hubungi 0812345***** ya');
      expect(maskPhoneInText('nomor 0812-3456-7890')).toBe('nomor 0812-345*****');
      expect(maskPhoneInText('wa.me/6281234567890')).toBe('wa.me/62812345*****');
    });
  });

  describe('4. formatPhoneForReport (Watchdog Non-Masking Format)', () => {
    it('memformat nomor dengan tanda hubung dan TIDAK menyensor angka (kebutuhan owner)', () => {
      // Menguji fungsi produksi langsung dari src/services/nightly-watchdog.service.ts
      const out = formatPhoneForReport('081234567890');
      expect(out).toBe('0812-3456-7890');
      // Verifikasi TIDAK ada bintang (*) sensor
      expect(out).not.toContain('*');
    });

    it('mengembalikan nomor pendek apa adanya jika <= 4 digit', () => {
      expect(formatPhoneForReport('123')).toBe('123');
      expect(formatPhoneForReport('1234')).toBe('1234');
    });
  });
});
