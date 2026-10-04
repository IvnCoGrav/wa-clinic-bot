import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';

/**
 * Fase 5 (Revisi Turn-0) — DITUNDA. Perilaku saat ini didokumentasikan di sini:
 * trimmer tetap memangkas ke ≤3 kalimat dan BELUM ada jaminan khusus pertanyaan
 * penutup (lihat docs/KNOWN_ISSUES.md #222 untuk rencana lanjutan).
 */
describe('v3 sanitizer trimmer contract (Fase 5 ditunda)', () => {
  it('prosa 4 kalimat → dipangkas ≤3 kalimat', () => {
    const draft = 'Satu ya Bunda. Dua ya Bunda. Tiga ya Bunda. Empat TIDAK.';
    const out = OutputSanitizer.trimToMaxSentences(draft, 3);
    const count = out.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0).length;
    expect(count).toBeLessThanOrEqual(3);
    expect(out).not.toContain('Empat');
  });

  it('daftar setelah ":" tetap utuh', () => {
    const draft =
      'Halo Bunda, promo jalan ya. Untuk paketnya ada dua pilihan nih:\n\n' +
      '1. Cukur + Pijat Ceria Rp 80.000\n2. Full Cukur + Ceria + Mandi Rp 100.000';
    const out = OutputSanitizer.trimToMaxSentences(draft, 3);
    expect(out).toContain('2. Full Cukur + Ceria + Mandi');
  });
});
