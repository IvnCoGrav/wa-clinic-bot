import { describe, it, expect } from 'vitest';
import {
  hasScheduleSignal,
  extractTimeOfDayHint,
} from '../../src/v3/agent/pipeline/medical-signal-detector';

/**
 * Fase 2 (sesi 180166 FM3) — sinyal jam & preferredTime anti-amnesia.
 * Seam: hasScheduleSignal + extractTimeOfDayHint (murni, gaya includes/token
 * seperti modul ini — tanpa regex semantik baru).
 */
describe('Deteksi Preferensi Jam (anti-amnesia waktu)', () => {
  it('"Sktr jam 10 pagi kalau bisa" = sinyal jadwal', () => {
    expect(hasScheduleSignal('Sktr jam 10 pagi kalau bisa')).toBe(true);
  });

  it('"pukul 14.00 bisa?" = sinyal jadwal', () => {
    expect(hasScheduleSignal('pukul 14.00 bisa?')).toBe(true);
  });

  it('sapaan "Selamat pagi" BUKAN sinyal jadwal', () => {
    expect(hasScheduleSignal('Selamat pagi mbak')).toBe(false);
  });

  it('"pagi" telanjang tanpa penanda jam BUKAN sinyal jadwal', () => {
    expect(hasScheduleSignal('pagi ini saya sibuk')).toBe(false);
  });

  it('extractTimeOfDayHint: "Sktr jam 10 pagi kalau bisa" -> "jam 10 pagi"', () => {
    expect(extractTimeOfDayHint('Sktr jam 10 pagi kalau bisa')).toBe('jam 10 pagi');
  });

  it('extractTimeOfDayHint: "pukul 14.00" -> "pukul 14.00"', () => {
    expect(extractTimeOfDayHint('sekitar pukul 14.00 ya')).toBe('pukul 14.00');
  });

  it('extractTimeOfDayHint: tanpa penanda jam -> null', () => {
    expect(extractTimeOfDayHint('Bisa hari Sabtu ya')).toBeNull();
    expect(extractTimeOfDayHint('Selamat pagi mbak')).toBeNull();
  });
});
