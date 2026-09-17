import { describe, it, expect } from 'vitest';
import {
  composeSystemPrompt,
  derivePhaseFocus,
  STABLE_PREFIX_MARKER,
} from '../../../src/v3/agent/prompt/prompt-composer';
import { buildCacheableSystemPrompt } from '../../../src/integrations/llm/prompt-cache';

/**
 * Fase 3.5 — Dynamic Phase Injection (seam: composeSystemPrompt + derivePhaseFocus).
 *
 * Kontrak: default (tanpa opt) = rakitan penuh identik eksisting (safe-mode);
 * injeksi fase bersifat opt-in dan TIDAK membatalkan prompt-cache (prefix
 * statis byte-identik pada mode focus; mode slim mendokumentasikan prefix
 * berbeda per-profil).
 */
describe('Dynamic Phase Injection', () => {
  it('default: rakitan penuh — lokasi + pricing + scheduling termuat, tanpa blok fokus', () => {
    const p = composeSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(p).toContain('PERTANYAAN ASAL / LOKASI KLINIK');
    expect(p).toContain('KONDISI A.1');
    expect(p).toContain('KONTROL PERTANYAAN PENUTUP');
    expect(p).not.toContain('[PHASE_FOCUS');
    expect(p.split(STABLE_PREFIX_MARKER)).toHaveLength(2);
  });

  it('derivePhaseFocus: Turn-0 tanpa lokasi -> EARLY_LOCATION', () => {
    expect(derivePhaseFocus({ genderGreeting: 'Bunda' } as any)).toEqual(['EARLY_LOCATION']);
  });

  it('derivePhaseFocus: lokasi diketahui -> CONSULTATION; cart/booking aktif -> +SCHEDULING', () => {
    expect(
      derivePhaseFocus({ genderGreeting: 'Bunda', location: { kelurahan: 'Kureksari' } } as any)
    ).toEqual(['CONSULTATION']);
    expect(
      derivePhaseFocus({
        genderGreeting: 'Bunda',
        location: { kelurahan: 'Kureksari' },
        cartItems: [{ name: 'Pijat Bayi Ceria' }],
      } as any)
    ).toEqual(['CONSULTATION', 'SCHEDULING']);
    expect(
      derivePhaseFocus({
        genderGreeting: 'Bunda',
        location: { kelurahan: 'Kureksari' },
        booking: { preferredDate: 'Sabtu' },
      } as any)
    ).toEqual(['CONSULTATION', 'SCHEDULING']);
  });

  it('mode focus: prefix stabil IDENTIK dengan default (cache hit lestari)', () => {
    const session = { genderGreeting: 'Bunda' } as any;
    const full = composeSystemPrompt(session, true);
    const focused = composeSystemPrompt(session, true, {
      phaseInjection: { focus: ['EARLY_LOCATION'] },
    });
    expect(focused).toContain('[PHASE_FOCUS: EARLY_LOCATION]');
    const fullParts = buildCacheableSystemPrompt(full, STABLE_PREFIX_MARKER);
    const focusParts = buildCacheableSystemPrompt(focused, STABLE_PREFIX_MARKER);
    expect(focusParts.stablePrefix).toBe(fullParts.stablePrefix);
    expect(focusParts.volatileSuffix).not.toBe(fullParts.volatileSuffix);
  });

  it('mode slim EARLY: direktif lokasi termuat, nota multi-anak & scheduling terkompresi', () => {
    const p = composeSystemPrompt({ genderGreeting: 'Bunda' } as any, true, {
      phaseInjection: { focus: ['EARLY_LOCATION'], slim: true },
    });
    expect(p).toContain('PERTANYAAN ASAL / LOKASI KLINIK');
    expect(p).not.toContain('MULTI-PASIEN DALAM 1 KUNJUNGAN');
    expect(p).not.toContain('KONTROL PERTANYAAN PENUTUP');
    expect(p.split(STABLE_PREFIX_MARKER)).toHaveLength(2);
  });

  it('mode slim SCHEDULING: gating reservasi aktif, deskripsi konsultasi gejala terisolasi', () => {
    const session = {
      genderGreeting: 'Bunda',
      location: { kelurahan: 'Kureksari' },
      booking: { preferredDate: 'Sabtu' },
    } as any;
    const p = composeSystemPrompt(session, true, {
      phaseInjection: { focus: ['SCHEDULING'], slim: true },
    });
    expect(p).toContain('MANDAT POV FIRST PERSON');
    expect(p).toContain('save_reservation (ALUR KONFIRMASI');
    expect(p).not.toContain('KONDISI A.1');
    expect(p.split(STABLE_PREFIX_MARKER)).toHaveLength(2);
  });
});
