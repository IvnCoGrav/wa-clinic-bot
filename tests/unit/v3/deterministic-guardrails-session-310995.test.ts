import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';
import { executeSearchKnowledgeFaq } from '../../../src/v3/tools/search-knowledge-faq.tool';
import { isPastBookingDateText } from '../../../src/utils/date-confirmation';
import { OutputSanitizer } from '../../../src/v3/guardrails/sanitizer';

/**
 * Audit sesi 310995 — Balita 2 Tahun, Kutisari Indah Surabaya.
 *
 * BAGIAN A (DETERMINISTIK — dieksekusi):
 *   A1. Durasi menit mengalir saat customer tanya lama waktu tanpa harga.
 *   A2. Tidak ada placeholder "*Rp [total]*" di output.
 *   A3. FAQ tool memuat panduan penutup statement-only.
 *   A4. Tanggal masa lalu ditolak.
 *
 * BAGIAN B (LLM-DEPENDEN — SKIP; daftar untuk dijalankan manual):
 *   B1. Balasan akhir pada pertanyaan SOP tidak menodong jadwal.
 *   B2. Balasan biaya multi-pilihan tidak memuat placeholder.
 */

describe('A1. Durasi tanpa harga (310995)', () => {
  it('asksDuration=true + inquirePrice=false → menit hadir, nominal tidak', async () => {
    const out = await executeGetCatalog({ inquirePrice: false, asksDuration: true, symptoms: ['batuk'] });
    expect(out.treatments.some((t) => typeof t.durationMinutes === 'number')).toBe(true);
    expect(out.message).toMatch(/menit/i);
    for (const t of out.treatments) {
      expect(t.promoPrice).toBeUndefined();
      expect(t.originalPrice).toBeUndefined();
    }
    expect(out.message).not.toMatch(/Rp/i);
  });
});

describe('A2. Anti-bocor placeholder (310995)', () => {
  it('sanitizer membuang "*Rp [total]*" tanpa merusak nominal nyata', () => {
    expect(OutputSanitizer.stripSystemPlaceholders('totalnya jadi *Rp [total]* ya')).not.toMatch(/\[total\]/i);
    const clean = 'totalnya *Rp 100.000* ya Bunda';
    expect(OutputSanitizer.stripSystemPlaceholders(clean)).toBe(clean);
  });
});

describe('A3. FAQ tool statement-only (310995)', () => {
  it('message memuat larangan menambah pertanyaan jadwal', async () => {
    const out = await executeSearchKnowledgeFaq({ query: 'persiapan minyak telon' });
    expect(out.message).toMatch(/DILARANG MENAMBAHKAN PERTANYAAN JADWAL/i);
  });
});

describe('A4. Temporal gate tanggal lampau (310995)', () => {
  const now = new Date(2026, 8, 17);
  it('"18 Agustus 2026" ditandai lampau saat kini September 2026', () => {
    expect(isPastBookingDateText('Selasa, 18 Agustus 2026', now)).toBe(true);
  });
  it('"besok"/"sabtu"/tanggal depan tidak ditandai', () => {
    expect(isPastBookingDateText('besok', now)).toBe(false);
    expect(isPastBookingDateText('20 September 2026', now)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BAGIAN B — LLM-DEPENDEN (SKIP; jalankan manual)
// ─────────────────────────────────────────────────────────────────────────────

describe.skip('B1. Balasan SOP tidak menodong jadwal (manual — LLM live)', () => {
  it('"Ni kudu nyiapin apa? Pakai baby oil atau minyak telon?" → tuntas, tanpa todong hari', () => {
    // Jalankan via `npm run chat`: balasan tidak memuat "jadwalkan ... hari apa".
    expect(true).toBe(true);
  });
});

describe.skip('B2. Balasan biaya multi-pilihan tanpa placeholder (manual — LLM live)', () => {
  it('"Kalau balita 2 tahun kena biaya berapa? Ada ongkos jarak nya juga?" → harga + ongkir, tanpa *Rp [total]*', () => {
    // Assert: balasan memuat harga paket & ongkir, dan TIDAK memuat "[" + "]" placeholder.
    expect(true).toBe(true);
  });
});
