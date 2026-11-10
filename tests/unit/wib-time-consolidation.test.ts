import { describe, it, expect } from 'vitest';
import {
  wibDayRangeToUtc,
  getWibTimeInfo,
  startOfTodayWib,
  formatWibDateYYYYMMDD,
  getWibDayName,
  WIB_OFFSET_MS,
} from '../../src/utils/wib-time';
import * as timeWibFacade from '../../src/utils/time-wib';

describe('CFG-10: WIB Time Consolidation Tests', () => {
  it('facade re-exports exact implementations from wib-time', () => {
    expect(timeWibFacade.getWibTimeInfo).toBe(getWibTimeInfo);
    expect(timeWibFacade.wibDayRangeToUtc).toBe(wibDayRangeToUtc);
    expect(timeWibFacade.startOfTodayWib).toBe(startOfTodayWib);
  });

  it('wibDayRangeToUtc converts YYYY-MM-DD correctly to UTC window', () => {
    const range = wibDayRangeToUtc('2026-11-10');
    expect(range).not.toBeNull();
    // 2026-11-10 00:00:00 WIB is 2026-11-09 17:00:00 UTC
    expect(range?.start.toISOString()).toBe('2026-11-09T17:00:00.000Z');
    // 2026-11-10 23:59:59.999 WIB is 2026-11-10 16:59:59.999 UTC
    expect(range?.end.toISOString()).toBe('2026-11-10T16:59:59.999Z');
  });

  it('getWibTimeInfo calculates correct time of day and greeting', () => {
    // 10:00:00 UTC is 17:00:00 WIB (sore)
    const testDate = new Date('2026-11-10T10:00:00.000Z');
    const info = getWibTimeInfo(testDate);
    expect(info.hourWib).toBe(17);
    expect(info.timeOfDay).toBe('sore');
    expect(info.greetingRecommendation).toBe('Selamat Sore');
  });
});
