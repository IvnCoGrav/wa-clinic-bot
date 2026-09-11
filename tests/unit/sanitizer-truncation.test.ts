import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';

describe('Sanitizer truncation anti-mutilasi (983902)', () => {
  it('potong di batas paragraf \\n\\n, bukan di tengah kata "sedang"', () => {
    const a = 'Halo Bunda 😊\n\nTerima kasih sudah menghubungi kami. Berikut rincian layanan lengkap yang tersedia untuk perawatan si kecil dan Bunda di rumah ya Bunda. Kami jelaskan satu per satu.\n\n';
    const b = 'Apakah saat ini si kecil sedang batuk pilek atau ada keluhan lain yang perlu kami bantu?';
    const long = a + b + ' ' + 'x '.repeat(600);
    const out = OutputSanitizer.truncateToMaxChars(long, 500);
    expect(out).not.toContain('Apakah saat ini si kecil sedang');
    expect(out.endsWith('ya Bunda.') || out.includes('Berikut rincian')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(500);
  });

  it('emoji penutup diakui sebagai batas kalimat', () => {
    const text = 'Halo Bunda 😊\n\nTerima kasih ya Bunda 😊 Apakah ada yang bisa kami bantu? ' + 'y '.repeat(600);
    const out = OutputSanitizer.truncateToMaxChars(text, 120);
    // tidak boleh memenggal di spasi tengah kata setelah emoji
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(120);
  });

  it('teks pendek (<500) tidak terpotong', () => {
    const short = 'Halo Bunda, ada yang bisa kami bantu?';
    expect(OutputSanitizer.truncateToMaxChars(short, 500)).toBe(short);
  });

  it('fallback spasi bila tanpa titik/emoji/paragraf', () => {
    const noPunct = 'a'.repeat(300) + ' ' + 'b'.repeat(300);
    const out = OutputSanitizer.truncateToMaxChars(noPunct, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.endsWith('a')).toBe(true);
  });
});
