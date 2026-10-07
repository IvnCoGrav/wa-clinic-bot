import { describe, it, expect } from 'vitest';
import { isWithinFollowUpWorkingHours } from '../../src/services/follow-up.service';

// V8 — Gerbang jam kerja deterministik (09:00–17:00 WIB). Uji batas & zona WIB,
// bukan happy-path. 09:00 WIB = 02:00 UTC; 17:00 WIB = 10:00 UTC.
describe('V8: isWithinFollowUpWorkingHours (gerbang jam kerja WIB)', () => {
  const at = (utcHour: number, utcMinute = 0) =>
    new Date(Date.UTC(2026, 9, 5, utcHour, utcMinute, 0, 0)); // 2026-10-05

  it('subuh 06:00 WIB (23:00 UTC sehari sebelumnya) → DILARANG', () => {
    // 06:00 WIB = 23:00 UTC (hari sebelumnya)
    expect(isWithinFollowUpWorkingHours(new Date(Date.UTC(2026, 9, 4, 23, 0, 0)))).toBe(false);
  });

  it('20:00 WIB (13:00 UTC) → DILARANG', () => {
    expect(isWithinFollowUpWorkingHours(at(13, 0))).toBe(false);
  });

  it('tepat 09:00 WIB (02:00 UTC) → DIIZINKAN (batas inklusif)', () => {
    expect(isWithinFollowUpWorkingHours(at(2, 0))).toBe(true);
  });

  it('tepat 16:59 WIB (09:59 UTC) → DIIZINKAN', () => {
    expect(isWithinFollowUpWorkingHours(at(9, 59))).toBe(true);
  });

  it('tepat 17:00 WIB (10:00 UTC) → DILARANG (batas eksklusif)', () => {
    expect(isWithinFollowUpWorkingHours(at(10, 0))).toBe(false);
  });

  it('12:00 WIB (05:00 UTC) → DIIZINKAN', () => {
    expect(isWithinFollowUpWorkingHours(at(5, 0))).toBe(true);
  });
});
