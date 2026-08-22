import { describe, it, expect } from 'vitest';
import {
  sanitizeStrayBackslashes,
  sanitizeHallucinatedTerms,
  sanitizeEmDash,
} from '../../src/utils/language-sanitizer';
import { TypingService } from '../../src/services/typing.service';

describe('Language Sanitizer Fixes & Typing Delay Tuning', () => {
  describe('1. Stray Backslashes & JSON Escape Artifacts', () => {
    it('should clean "\\Bundlebih" and "\\Bund" artifacts to "Bunda lebih" / "Bunda"', () => {
      const dirty = 'Dengan layanan homecare ini, \\Bundlebih nyaman karena tidak perlu keluar rumah.';
      const cleaned = sanitizeStrayBackslashes(dirty);
      expect(cleaned).toBe('Dengan layanan homecare ini, Bunda lebih nyaman karena tidak perlu keluar rumah.');
    });

    it('should remove stray backslashes before regular alphabetic characters', () => {
      const dirty = 'Halo \\Bunda, ini jadwal \\treatment kami';
      const cleaned = sanitizeStrayBackslashes(dirty);
      expect(cleaned).toBe('Halo Bunda, ini jadwal treatment kami');
    });

    it('should clean double backslashes', () => {
      const dirty = 'Info penting\\\\ untuk Bunda';
      const cleaned = sanitizeStrayBackslashes(dirty);
      expect(cleaned).toBe('Info penting untuk Bunda');
    });
  });

  describe('2. Anti-Hallucination Baby Name Sanitizer', () => {
    it('should sanitize "untuk Bunny" to "untuk si kecil"', () => {
      const dirty = 'Ada yang bisa saya bantu terkait treatment untuk Bunny ya, Bund?';
      const cleaned = sanitizeHallucinatedTerms(dirty);
      expect(cleaned).toBe('Ada yang bisa saya bantu terkait treatment untuk si kecil ya, Bunda?');
    });

    it('should sanitize "terkait Bunny" and "si Bunny"', () => {
      const dirty = 'Bagaimana kondisi si Bunny hari ini?';
      const cleaned = sanitizeHallucinatedTerms(dirty);
      expect(cleaned).toBe('Bagaimana kondisi si kecil hari ini?');
    });
  });

  describe('3. Combined Sanitization Pipeline', () => {
    it('should properly clean the exact Case #319 text artifact', () => {
      const rawText = 'Dengan layanan homecare ini,\\Bundlebih nyaman karena tidak perlu keluar rumah, cukup menunggu di rumah saja. 😊\n\nAda yang bisa saya bantu terkait treatment untuk Bunny ya, Bund?';
      const cleaned = sanitizeStrayBackslashes(sanitizeHallucinatedTerms(sanitizeEmDash(rawText)));
      expect(cleaned).not.toContain('\\Bundlebih');
      expect(cleaned).not.toContain('Bunny');
      expect(cleaned).toContain('Bunda lebih nyaman');
      expect(cleaned).toContain('untuk si kecil');
    });
  });

  describe('4. Typing Delay Cap Tuning', () => {
    it('should cap long text typing delay to maximum 6500ms without jitter', () => {
      const typingSvc = new TypingService();
      const longText = 'Ini adalah pesan yang sangat amat panjang sekali yang terdiri dari banyak kata untuk menguji apakah delay pengetikan bot dibatasi secara proporsional dan tidak membuat customer menunggu belasan detik di WhatsApp.';
      const delay = typingSvc.calculateTypingDelay(longText, true);
      expect(delay).toBeLessThanOrEqual(6500);
      expect(delay).toBe(6500);
    });
  });
});
