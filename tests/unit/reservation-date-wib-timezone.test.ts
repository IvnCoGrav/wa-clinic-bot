import { describe, it, expect } from 'vitest';
import {
  getWibDayOfWeek,
  detectDateMismatch,
  tryParseIndonesianDate,
} from '../../src/utils/reservation-date-parser';

describe('UTL-02: Reservation Date Parser WIB Timezone Safety', () => {
  it('should determine day of week based on WIB regardless of UTC offset', () => {
    // 2026-08-29 at 02:00 WIB is 2026-08-28 19:00 UTC (Friday in UTC, Saturday in WIB)
    const earlyMorningWib = new Date('2026-08-29T02:00:00+07:00');
    expect(earlyMorningWib.toISOString()).toBe('2026-08-28T19:00:00.000Z');

    // Server process running in UTC would return 5 for earlyMorningWib.getUTCDay()
    expect(earlyMorningWib.getUTCDay()).toBe(5); // Friday in UTC

    // BUT in WIB it must be Saturday (6)
    expect(getWibDayOfWeek(earlyMorningWib)).toBe(6); // Saturday in WIB!
  });

  it('detectDateMismatch should NOT report mismatch for Saturday early morning (02:00 WIB)', () => {
    // Customer writes: "Sabtu 29 agustus jam 02.00"
    const text = 'Sabtu 29 agustus jam 02.00';
    const parsed = tryParseIndonesianDate(text);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    // In WIB, 29 Agustus 2026 is Saturday
    expect(getWibDayOfWeek(parsed)).toBe(6);

    const mismatchCheck = detectDateMismatch(parsed, text);
    expect(mismatchCheck.mismatch).toBe(false);
  });

  it('detectDateMismatch should report mismatch when written day actually conflicts with calendar by >= 2 days', () => {
    // 29 Agustus 2026 is Saturday. If customer writes "Rabu 29 agustus" (diff 3 days)
    const text = 'Rabu 29 agustus jam 10.00';
    const parsed = tryParseIndonesianDate(text);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    const mismatchCheck = detectDateMismatch(parsed, text);
    expect(mismatchCheck.mismatch).toBe(true);
    expect(mismatchCheck.writtenDay).toBe('rabu');
    expect(mismatchCheck.actualDay).toBe('sabtu');
  });
});
