import { describe, it, expect } from 'vitest';
import { composeRouterPrompt } from '../../../src/v3/agent/prompt/prompt-composer';

/**
 * Fase 3 (router layering) — kontrak perakitan Call 1.
 * Seam: composeRouterPrompt default (byte-identik) vs masker-aware.
 */
describe('Router Prompt Layering (Fase 3)', () => {
  const session = { genderGreeting: 'Bunda' } as any;

  it('default: jahitan antar-layer utuh (byte-identical assembly)', () => {
    const p = composeRouterPrompt(session, false);
    expect(p).toContain('TUGAS UTAMAMU (CALL 1 - TOOL ROUTING & EVALUASI INTENT):\n1. Evaluasi');
    expect(p).toContain('manusia.\n2. Jika pesan customer TIDAK memerlukan');
    expect(p).toContain('diinginkan.\n\n');
    expect(p).toContain('KONTRAK BUNDLING');
  });

  it('masked: bullet save diganti satu baris status, sisa utuh', () => {
    const m = composeRouterPrompt(session, false, { isSaveReservationMasked: true });
    expect(m).not.toContain('KONTRAK BUNDLING');
    expect(m).toContain('SAAT INI DISEMBUNYIKAN');
    expect(m).toContain('TUGAS UTAMAMU');
    expect(m).toContain('2. Jika pesan customer TIDAK memerlukan');
  });

  it('masked=false eksplisit identik dengan default', () => {
    expect(composeRouterPrompt(session, true, { isSaveReservationMasked: false })).toBe(
      composeRouterPrompt(session, true)
    );
  });

  it('mandat preservasi entitas utuh (sesi 337880): locationText DILARANG dipotong', () => {
    const p = composeRouterPrompt(session, false);
    expect(p).toContain('secara UTUH tanpa memotong kata apa pun');
    expect(p).toContain('Waru Kepuh Kiriman');
  });
});
