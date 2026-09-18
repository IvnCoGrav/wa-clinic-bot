import { describe, it, expect } from 'vitest';
import { salvageValidSentences, splitSentences } from '../../../src/v3/guardrails/sentence-salvage';

/**
 * P4 — Surgical salvage: saat reprompt faktual gagal, buang HANYA kalimat
 * yang melanggar (batas kalimat utuh), kirim inti valid + catatan handoff.
 * ANTI-MUTILASI: isi kalimat yang dipertahankan TIDAK PERNAH diedit
 * (verbatim substring input) — hanya filter tingkat kalimat + gabung.
 */
const catalogTools = [
  {
    name: 'get_catalog_and_price',
    result: {
      treatments: [{ name: 'Pijat Bayi Ceria', durationMinutes: 60 }],
    },
  },
];

describe('sentence-salvage — filter tingkat kalimat, tanpa edit isi', () => {
  it('splitter hanya memotong di batas kalimat', () => {
    const parts = splitSentences('Halo Bunda! Durasinya 60 menit ya. Terima kasih 🙏');
    expect(parts).toEqual(['Halo Bunda!', 'Durasinya 60 menit ya.', 'Terima kasih 🙏']);
  });

  it('campuran valid + halusinasi → valid dipertahankan verbatim, halusinasi dibuang', () => {
    const reply =
      'Untuk *Pijat Bayi Ceria*, durasinya 60 menit ya Bunda. ' +
      'Kami juga sediakan *Pijat Ajaib Super* yang menyembuhkan semua penyakit.';
    const res = salvageValidSentences(reply, catalogTools as any, [], {});
    expect(res.kept).toHaveLength(1);
    expect(res.dropped).toHaveLength(1);
    // Verbatim: tanpa edit isi kalimat yang dipertahankan.
    for (const s of res.kept) expect(reply).toContain(s);
    expect(res.droppedViolations.length).toBeGreaterThan(0);
  });

  it('semua kalimat melanggar → kept kosong (panggil fallback generik)', () => {
    const res = salvageValidSentences(
      'Kami sediakan *Pijat Ajaib Super* yang menyembuhkan semua penyakit.',
      catalogTools as any,
      [],
      {}
    );
    expect(res.kept).toHaveLength(0);
    expect(res.dropped).toHaveLength(1);
  });

  it('semua valid → passthrough penuh', () => {
    const reply = 'Halo Bunda! Durasinya 60 menit ya.';
    const res = salvageValidSentences(reply, catalogTools as any, [], {});
    expect(res.kept.join(' ')).toBe(reply);
    expect(res.dropped).toHaveLength(0);
  });

  it('input kosong / bukan string → kosong tanpa throw', () => {
    expect(salvageValidSentences('', [], [], {}).kept).toEqual([]);
    expect(salvageValidSentences('   ', [], [], {}).kept).toEqual([]);
  });
});
