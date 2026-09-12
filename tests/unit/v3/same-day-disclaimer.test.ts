import { describe, it, expect } from 'vitest';
import {
  ensureSameDayDisclaimer,
} from '../../../src/v3/agent/pipeline/guardrail-pipeline';
import {
  SAME_DAY_DISCLAIMER,
} from '../../../src/v3/agent/pipeline/generation-stage';

/**
 * Sesi 462651 Turn 5 — disclaimer same-day DILARANG dibuang Call 2.
 * Lapisan deterministik: tidak ada indikasi penuh → sisipkan resmi.
 */
describe('Same-Day Disclaimer Enforcement (sesi 462651)', () => {
  it('tanpa indikasi penuh -> disclaimer disisipkan utuh', () => {
    const out = ensureSameDayDisclaimer(
      'Untuk hari ini jam 16.00, kami akan coba cek ketersediaan jadwal ya Bunda 😊🙏'
    );
    expect(out).toContain(SAME_DAY_DISCLAIMER);
    expect(out).toContain('kemungkinan jadwal kami penuh');
  });

  it('sudah ada indikasi penuh (parafrasa model) -> tidak diduplikasi', () => {
    const reply = 'Kalau hari ini kemungkinan penuh ya Bunda, kami cekkan dulu.';
    expect(ensureSameDayDisclaimer(reply)).toBe(reply);
  });

  it('balasan kosong -> dikembalikan apa adanya (anti error)', () => {
    expect(ensureSameDayDisclaimer('')).toBe('');
    expect(ensureSameDayDisclaimer('   ')).toBe('   ');
  });

  it('disclaimer resmi: first-person, tanpa nominal', () => {
    expect(SAME_DAY_DISCLAIMER).toContain('kami');
    expect(SAME_DAY_DISCLAIMER).not.toMatch(/\bsaya\b/i);
    expect(SAME_DAY_DISCLAIMER).not.toMatch(/Rp/i);
  });
});
