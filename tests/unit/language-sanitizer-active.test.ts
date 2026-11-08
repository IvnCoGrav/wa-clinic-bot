import { describe, it, expect } from 'vitest';
import {
  stripNonIndonesianScripts,
  sanitizeEmDash,
  sanitizeStrayBackslashes,
} from '../../src/utils/language-sanitizer';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';

describe('Active Language Sanitizers (D1 Opsi A: Teknis Non-Semantik)', () => {
  describe('1. stripNonIndonesianScripts (Anti Bocor Aksara Asing)', () => {
    it('membuang karakter Mandarin/CJK dari tengah kalimat', () => {
      const input = 'Boleh tahu大概 lokasinya di mana ya, Bunda? Supaya bisa kami bantu cekkan';
      const out = stripNonIndonesianScripts(input);
      expect(out).not.toContain('大概');
      expect(out).toContain('Boleh tahu');
      expect(out).toContain('lokasinya di mana');
    });

    it('membersihkan aksara Kanji Jepang & Hangul Korea', () => {
      expect(stripNonIndonesianScripts('あいう karena itu にほん')).toBe(' karena itu ');
      expect(stripNonIndonesianScripts('안녕 halo')).toBe(' halo');
    });

    it('membersihkan aksara Cyrillic Rusia', () => {
      expect(stripNonIndonesianScripts('привет selamat')).toBe(' selamat');
    });

    it('tidak mengubah teks normal (latin, angka, format rupiah, dan emoji)', () => {
      const normal = 'Halo Bunda, harganya *Rp 60.000* untuk 40 menit ya 🙏🏻';
      expect(stripNonIndonesianScripts(normal)).toBe(normal);
    });
  });

  describe('2. sanitizeEmDash (Anti-Slop Em-Dash)', () => {
    it('mengubah em-dash rentang angka menjadi tanda minus / hyphen', () => {
      expect(sanitizeEmDash('jam 9—11 siang')).toBe('jam 9-11 siang');
    });

    it('mengubah bullet list em-dash di awal baris menjadi "- "', () => {
      expect(sanitizeEmDash('— Gratis ongkir')).toBe('- Gratis ongkir');
    });

    it('mengubah pemisah antar-klausa em-dash menjadi koma', () => {
      expect(sanitizeEmDash('Halo—mau tanya')).toBe('Halo, mau tanya');
    });
  });

  describe('3. sanitizeStrayBackslashes (Anti-Escape Backslash Liar)', () => {
    it('membersihkan \\Bundlebih dan \\Bund menjadi Bunda lebih / Bunda', () => {
      const dirty = 'Dengan layanan homecare ini, \\Bundlebih nyaman karena tidak perlu keluar rumah.';
      expect(sanitizeStrayBackslashes(dirty)).toBe('Dengan layanan homecare ini, Bunda lebih nyaman karena tidak perlu keluar rumah.');
    });

    it('membersihkan backslash liar di depan kata biasa', () => {
      const dirty = 'Halo \\Bunda, ini jadwal \\treatment kami';
      expect(sanitizeStrayBackslashes(dirty)).toBe('Halo Bunda, ini jadwal treatment kami');
    });

    it('membersihkan dobel backslash', () => {
      const dirty = 'Info penting\\\\ untuk Bunda';
      expect(sanitizeStrayBackslashes(dirty)).toBe('Info penting untuk Bunda');
    });
  });

  describe('4. Integrasi ke OutputSanitizer.cleanOutboundReply', () => {
    it('membuang aksara asing dan backslash liar dari balasan outbound akhir', () => {
      const raw = 'Halo \\Bundlebih baik ambil paket Ceria ya Bunda 😊 大概 ada promo menarik!';
      const cleaned = OutputSanitizer.cleanOutboundReply(raw, 'tanya paket', false);
      expect(cleaned).not.toContain('大概');
      expect(cleaned).not.toContain('\\');
      expect(cleaned).toContain('Bunda lebih baik');
    });
  });
});
