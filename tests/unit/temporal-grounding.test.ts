import { describe, it, expect } from 'vitest';
import { getRealTimeTemporalGrounding } from '../../src/utils/temporal-grounding';
import { composeRouterPrompt, composeSystemPrompt } from '../../src/v3/agent/prompt/prompt-composer';

/**
 * Fase 1 (sesi 180166 FM2) — Temporal grounding real-time (WIB).
 * Seam: getRealTimeTemporalGrounding (murni, refDate disuntik) + injeksi blok
 * ke prompt Call 1/Call 2 di wilayah volatil (prefix cache lestari).
 */
describe('Temporal Grounding Real-Time (WIB)', () => {
  // Kamis, 17 September 2026 10:00 WIB — jangkar deterministik.
  const ref = new Date('2026-09-17T10:00:00+07:00');

  it('jangkar kalender benar: hari ini Kamis 17 Sep 2026 + 7 hari ke depan', () => {
    const g = getRealTimeTemporalGrounding(ref);
    expect(g.todayLine).toMatch(/kamis/i);
    expect(g.todayLine).toMatch(/17/);
    expect(g.todayLine).toMatch(/september/i);
    expect(g.todayLine).toMatch(/2026/);
    expect(g.weekLines.length).toBe(7);
    // "Selasa depan" dari Kamis 17 Sep = 22 September (5 hari ke depan).
    const tue = g.weekLines.find((l) => /selasa/i.test(l));
    expect(tue).toBeTruthy();
    expect(tue).toMatch(/22/);
  });

  it('relatif "besok/lusa" berakar kalender riil (18/19 Sep)', () => {
    const g = getRealTimeTemporalGrounding(ref);
    expect(g.weekLines[0]).toMatch(/jumat/i);
    expect(g.weekLines[0]).toMatch(/18/);
    expect(g.weekLines[1]).toMatch(/sabtu/i);
    expect(g.weekLines[1]).toMatch(/19/);
  });

  it('blok prompt memuat anchor + tidak menyebut tanggal fiktif', () => {
    const g = getRealTimeTemporalGrounding(ref);
    expect(g.block).toContain('[WAKTU & KALENDER SISTEM SAAT INI (WIB)]');
    expect(g.block).not.toMatch(/17 Oktober/i);
  });

  it('prompt Call 1 & Call 2 memuat blok temporal di wilayah volatil', () => {
    const session = { genderGreeting: 'Bunda' } as any;
    const r1 = composeRouterPrompt(session, true);
    const s2 = composeSystemPrompt(session, true);
    expect(r1).toContain('[WAKTU & KALENDER SISTEM SAAT INI (WIB)]');
    expect(s2).toContain('[WAKTU & KALENDER SISTEM SAAT INI (WIB)]');
    // Prefix stabil (sebelum marker) TIDAK mengandung blok temporal.
    const marker = '__STATIC_PERSONA_BLOCK_END__';
    expect(s2.split(marker)[0]).not.toContain('[WAKTU & KALENDER SISTEM SAAT INI (WIB)]');
  });
});
