import { describe, it, expect } from 'vitest';
import {
  getWibDateKey,
  isDifferentDayWib,
  formatWibTime,
  diffCalendarDaysWib,
  formatChatDateSeparatorWib,
  formatLastChatWib,
  getWibHoursAndMinutes,
  formatWibDate,
  buildWibIso,
  wibDayStartEnd,
} from '../../packages/admin-dashboard/src/utils/dateWib';
import { formatWibClock } from '../../packages/admin-dashboard/src/utils/geoUtils';

describe('Frontend dateWib Robustness & Adversarial Tests', () => {
  describe('getWibDateKey', () => {
    it('returns empty string for null, undefined, empty, or whitespace string', () => {
      expect(getWibDateKey(undefined)).toBe('');
      expect(getWibDateKey(null)).toBe('');
      expect(getWibDateKey('')).toBe('');
      expect(getWibDateKey('   ')).toBe('');
    });

    it('returns empty string for invalid date string or invalid Date object', () => {
      expect(getWibDateKey('not-a-date')).toBe('');
      expect(getWibDateKey('2026-99-99')).toBe('');
      expect(getWibDateKey(new Date(NaN))).toBe('');
    });

    it('returns YYYY-MM-DD in Asia/Jakarta timezone for valid dates', () => {
      // 2026-10-10 01:00 UTC = 2026-10-10 08:00 WIB
      expect(getWibDateKey('2026-10-10T01:00:00Z')).toBe('2026-10-10');
      // 2026-10-09 23:30 UTC = 2026-10-10 06:30 WIB
      expect(getWibDateKey('2026-10-09T23:30:00Z')).toBe('2026-10-10');
    });
  });

  describe('isDifferentDayWib', () => {
    it('does not throw when either or both arguments are undefined, null, or invalid', () => {
      expect(isDifferentDayWib(undefined, '2026-10-10')).toBe(false);
      expect(isDifferentDayWib(null, '2026-10-10')).toBe(false);
      expect(isDifferentDayWib('2026-10-10', undefined)).toBe(true);
      expect(isDifferentDayWib('2026-10-10', null)).toBe(true);
      expect(isDifferentDayWib(undefined, undefined)).toBe(false);
      expect(isDifferentDayWib('invalid', 'invalid')).toBe(false);
      expect(isDifferentDayWib('2026-10-10', 'invalid')).toBe(true);
      expect(isDifferentDayWib('invalid', '2026-10-10')).toBe(false);
    });

    it('correctly compares dates on valid inputs', () => {
      expect(isDifferentDayWib('2026-10-10T02:00:00Z', '2026-10-10T05:00:00Z')).toBe(false);
      expect(isDifferentDayWib('2026-10-11T02:00:00Z', '2026-10-10T05:00:00Z')).toBe(true);
    });
  });

  describe('formatWibTime', () => {
    it('returns empty string on null, undefined, empty, or invalid date', () => {
      expect(formatWibTime(undefined)).toBe('');
      expect(formatWibTime(null)).toBe('');
      expect(formatWibTime('')).toBe('');
      expect(formatWibTime('invalid-time')).toBe('');
      expect(formatWibTime(new Date(NaN))).toBe('');
    });

    it('formats valid dates in HH.mm WIB', () => {
      // 03:00 UTC = 10:00 WIB
      const res = formatWibTime('2026-10-10T03:00:00Z');
      expect(res).toBe('10.00');
    });
  });

  describe('diffCalendarDaysWib', () => {
    it('returns 0 if from or to is invalid or missing', () => {
      expect(diffCalendarDaysWib(undefined, '2026-10-10')).toBe(0);
      expect(diffCalendarDaysWib('invalid', new Date())).toBe(0);
      expect(diffCalendarDaysWib('2026-10-10', 'invalid')).toBe(0);
    });

    it('calculates calendar day differences in WIB without off-by-one errors', () => {
      expect(diffCalendarDaysWib('2026-10-10T01:00:00Z', '2026-10-11T01:00:00Z')).toBe(1);
      expect(diffCalendarDaysWib('2026-10-11T01:00:00Z', '2026-10-10T01:00:00Z')).toBe(-1);
    });
  });

  describe('formatChatDateSeparatorWib', () => {
    it('returns empty string on invalid or nullish date', () => {
      expect(formatChatDateSeparatorWib('')).toBe('');
      expect(formatChatDateSeparatorWib(undefined as any)).toBe('');
      expect(formatChatDateSeparatorWib(null as any)).toBe('');
      expect(formatChatDateSeparatorWib('invalid-date')).toBe('');
    });
  });

  describe('formatLastChatWib', () => {
    it('returns empty string on invalid or nullish date', () => {
      expect(formatLastChatWib(null)).toBe('');
      expect(formatLastChatWib(undefined)).toBe('');
      expect(formatLastChatWib('')).toBe('');
      expect(formatLastChatWib('invalid-date')).toBe('');
    });
  });

  describe('getWibHoursAndMinutes', () => {
    it('returns 0 hours/minutes and 00:00 for invalid or nullish date', () => {
      expect(getWibHoursAndMinutes(undefined)).toEqual({ hours: 0, minutes: 0, timeFormatted: '00:00' });
      expect(getWibHoursAndMinutes(null)).toEqual({ hours: 0, minutes: 0, timeFormatted: '00:00' });
      expect(getWibHoursAndMinutes('')).toEqual({ hours: 0, minutes: 0, timeFormatted: '00:00' });
      expect(getWibHoursAndMinutes('invalid-date')).toEqual({ hours: 0, minutes: 0, timeFormatted: '00:00' });
    });

    it('extracts WIB hours and minutes properly', () => {
      // 07:15 UTC = 14:15 WIB
      const res = getWibHoursAndMinutes('2026-10-10T07:15:00Z');
      expect(res.hours).toBe(14);
      expect(res.minutes).toBe(15);
      expect(res.timeFormatted).toBe('14:15');
    });
  });

  describe('formatWibDate', () => {
    it('returns empty string on invalid or nullish date', () => {
      expect(formatWibDate(undefined)).toBe('');
      expect(formatWibDate(null)).toBe('');
      expect(formatWibDate('')).toBe('');
      expect(formatWibDate('invalid-date')).toBe('');
    });
  });

  describe('buildWibIso', () => {
    it('returns empty string if dateKey is empty or whitespace', () => {
      expect(buildWibIso('', '09:00')).toBe('');
      expect(buildWibIso('   ', '09:00')).toBe('');
      expect(buildWibIso(null as any, '09:00')).toBe('');
    });

    it('builds canonical WIB ISO string', () => {
      expect(buildWibIso('2026-10-10', '09:00')).toBe('2026-10-10T09:00:00+07:00');
      expect(buildWibIso('2026-10-10', '9:30')).toBe('2026-10-10T09:30:00+07:00');
      expect(buildWibIso('2026-10-10', '09.30')).toBe('2026-10-10T09:30:00+07:00');
    });
  });

  describe('wibDayStartEnd', () => {
    it('does not throw and falls back gracefully when passed an invalid Date', () => {
      const bounds = wibDayStartEnd(new Date(NaN));
      expect(bounds.start).toBeInstanceOf(Date);
      expect(bounds.end).toBeInstanceOf(Date);
      expect(isNaN(bounds.start.getTime())).toBe(false);
      expect(isNaN(bounds.end.getTime())).toBe(false);
    });
  });

  describe('formatWibClock from geoUtils', () => {
    it('returns 00:00 on null, undefined, or invalid Date', () => {
      expect(formatWibClock(null)).toBe('00:00');
      expect(formatWibClock(undefined)).toBe('00:00');
      expect(formatWibClock(new Date(NaN))).toBe('00:00');
    });

    it('formats clock with minute offset accurately in WIB', () => {
      // 03:00 UTC = 10:00 WIB
      const base = new Date('2026-10-10T03:00:00Z');
      expect(formatWibClock(base, 0)).toBe('10:00');
      expect(formatWibClock(base, 25)).toBe('10:25');
    });
  });
});
