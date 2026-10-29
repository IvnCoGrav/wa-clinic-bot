import { describe, expect, it } from 'vitest';
import {
  formatHourLabel,
  formatHourLabelLong,
} from '../../packages/admin-dashboard/src/utils/calendarHourLabel';

/**
 * Fase 2 queue kalender: gutter jam harus HEMAT RUANG di HP.
 *
 * Sebelumnya label ditulis `6 am`, `12 pm`, `1 pm` — 4–5 karakter + spasi untuk
 * sesuatu yang bisa ditulis 2 angka. Di layar 360px gutter 70px itu ~19% lebar
 * layar hanya untuk label.
 *
 * Kontrak:
 * - `formatHourLabel` → TEPAT dua digit, tanpa `:00`, tanpa am/pm.
 * - `formatHourLabelLong` → dipakai `title`/tooltip, tetap informatif (`13:00`).
 */
describe('formatHourLabel — dua angka untuk gutter', () => {
  it('memberi dua digit untuk jam 0-9', () => {
    expect(formatHourLabel(6)).toBe('06');
    expect(formatHourLabel(8)).toBe('08');
    expect(formatHourLabel(9)).toBe('09');
  });

  it('memberi dua digit apa adanya untuk jam 10-23', () => {
    expect(formatHourLabel(10)).toBe('10');
    expect(formatHourLabel(13)).toBe('13');
    expect(formatHourLabel(21)).toBe('21');
    expect(formatHourLabel(23)).toBe('23');
  });

  it('tidak pernah mengandung ":00" atau am/pm', () => {
    for (let h = 0; h <= 23; h++) {
      const label = formatHourLabel(h);
      expect(label).toMatch(/^\d{2}$/);
      expect(label).not.toContain(':');
      expect(label.toLowerCase()).not.toContain('am');
      expect(label.toLowerCase()).not.toContain('pm');
    }
  });

  it('memakai 24 jam (13 tetap 13, bukan 1)', () => {
    expect(formatHourLabel(12)).toBe('12');
    expect(formatHourLabel(13)).not.toBe('01');
  });

  it('tahan terhadap jam tidak wajar tanpa crash', () => {
    expect(formatHourLabel(NaN)).toBe('00');
    expect(formatHourLabel(-1)).toBe('-1');
    expect(formatHourLabel(24)).toBe('24');
    expect(formatHourLabel(undefined as unknown as number)).toBe('00');
    expect(formatHourLabel('8' as unknown as number)).toBe('08');
  });
});

describe('formatHourLabelLong — tooltip tetap informatif', () => {
  it('menambahkan ":00" agar tidak ambigu di desktop', () => {
    expect(formatHourLabelLong(6)).toBe('06:00');
    expect(formatHourLabelLong(13)).toBe('13:00');
    expect(formatHourLabelLong(21)).toBe('21:00');
  });

  it('konsisten dengan label pendek (prefix sama)', () => {
    for (let h = 6; h <= 21; h++) {
      expect(formatHourLabelLong(h).startsWith(formatHourLabel(h))).toBe(true);
    }
  });
});
