import { describe, it, expect } from 'vitest';
import { getWibTimeInfo } from '../../src/utils/time-wib';

describe('WIB Time Helper Unit Tests', () => {
  it('should recommend Selamat Pagi between 03:00 and 10:59 WIB', () => {
    // 08:00 WIB is 01:00 UTC
    const dateUtc = new Date(Date.UTC(2026, 7, 11, 1, 0, 0));
    const info = getWibTimeInfo(dateUtc);
    expect(info.hourWib).toBe(8);
    expect(info.timeOfDay).toBe('pagi');
    expect(info.greetingRecommendation).toBe('Selamat Pagi');
  });

  it('should recommend Selamat Siang between 11:00 and 14:59 WIB', () => {
    // 13:00 WIB is 06:00 UTC
    const dateUtc = new Date(Date.UTC(2026, 7, 11, 6, 0, 0));
    const info = getWibTimeInfo(dateUtc);
    expect(info.hourWib).toBe(13);
    expect(info.timeOfDay).toBe('siang');
    expect(info.greetingRecommendation).toBe('Selamat Siang');
  });

  it('should recommend Selamat Sore between 15:00 and 17:59 WIB', () => {
    // 16:30 WIB is 09:30 UTC
    const dateUtc = new Date(Date.UTC(2026, 7, 11, 9, 30, 0));
    const info = getWibTimeInfo(dateUtc);
    expect(info.hourWib).toBe(16);
    expect(info.timeOfDay).toBe('sore');
    expect(info.greetingRecommendation).toBe('Selamat Sore');
  });

  it('should recommend Selamat Malam at 20:00 WIB (13:00 UTC)', () => {
    // 20:00 WIB is 13:00 UTC
    const dateUtc = new Date(Date.UTC(2026, 7, 11, 13, 0, 0));
    const info = getWibTimeInfo(dateUtc);
    expect(info.hourWib).toBe(20);
    expect(info.timeOfDay).toBe('malam');
    expect(info.greetingRecommendation).toBe('Selamat Malam');
  });
});
