import { describe, it, expect } from 'vitest';
import {
  parseMetaPixelId,
  parseWhatsappNumber,
  sanitizePixelForRender,
  sanitizePhoneForRender,
} from '../../src/utils/landing-fields';

describe('landing-fields contract', () => {
  describe('metaPixelId', () => {
    it('menerima digit 5-20 dan menormalkan trim', () => {
      expect(parseMetaPixelId(' 1234567890 ')).toEqual({ ok: true, value: '1234567890' });
    });

    it('menolak payload script dan karakter di luar charset pixel', () => {
      const payloads = [`';alert(1)//`, '</script><img src=x>', '12345 abc', '+-12345', '12345;', '12345"'];
      for (const p of payloads) {
        const r = parseMetaPixelId(p);
        expect(r.ok).toBe(false);
      }
    });

    it('menerima ID alfanumerik legacy (PIXEL_123)', () => {
      expect(parseMetaPixelId('PIXEL_123')).toEqual({ ok: true, value: 'PIXEL_123' });
    });

    it('kosong/null menjadi null', () => {
      expect(parseMetaPixelId('')).toEqual({ ok: true, value: null });
      expect(parseMetaPixelId(null)).toEqual({ ok: true, value: null });
      expect(parseMetaPixelId(undefined)).toEqual({ ok: true, value: null });
    });
  });

  describe('whatsappNumber', () => {
    it('menormalkan ke digit dan menerima format manusia', () => {
      expect(parseWhatsappNumber('+62 812-3456-7890')).toEqual({ ok: true, value: '6281234567890' });
      expect(parseWhatsappNumber('6281234567890')).toEqual({ ok: true, value: '6281234567890' });
    });

    it('menolak nomor terlalu pendek/panjang dan payload non-digit murni', () => {
      expect(parseWhatsappNumber('123').ok).toBe(false);
      expect(parseWhatsappNumber('1'.repeat(16)).ok).toBe(false);
      expect(parseWhatsappNumber('abc').ok).toBe(false);
      expect(parseWhatsappNumber('</script>').ok).toBe(false);
    });
  });

  describe('sanitasi data lama saat render', () => {
    it('pixel tidak valid menjadi string kosong', () => {
      expect(sanitizePixelForRender(`123';alert(1)//`)).toBe('');
      expect(sanitizePixelForRender(null)).toBe('');
      expect(sanitizePixelForRender('12345')).toBe('12345');
    });

    it('nomor tidak valid menjadi string kosong', () => {
      expect(sanitizePhoneForRender('abc')).toBe('');
      expect(sanitizePhoneForRender('+62 812 3456 7890')).toBe('6281234567890');
    });
  });
});
