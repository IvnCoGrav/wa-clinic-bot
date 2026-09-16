import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { trackInterval, clearAllIntervals, activeIntervalCount } from '../../src/lifecycle/interval-registry';

/**
 * FASE 1 — interval registry (PLAN 8).
 * Menguji perilaku adversarial: pendaftaran, pembersihan berulang, dan ketahanan
 * terhadap handle yang sudah di-clear.
 */

describe('FASE 1 — interval-registry', () => {
  afterEach(() => {
    clearAllIntervals();
    vi.useRealTimers();
  });

  it('trackInterval mendaftarkan handle dan menambah activeIntervalCount', () => {
    vi.useFakeTimers();
    const before = activeIntervalCount();
    trackInterval(() => {}, 1000);
    trackInterval(() => {}, 2000);
    expect(activeIntervalCount()).toBe(before + 2);
  });

  it('clearAllIntervals menghentikan semua interval dan mengembalikan count ke 0', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    trackInterval(spy, 1000);
    trackInterval(spy, 1000);
    clearAllIntervals();
    expect(activeIntervalCount()).toBe(0);

    vi.advanceTimersByTime(5000);
    expect(spy).not.toHaveBeenCalled();
  });

  it('clearAllIntervals aman dipanggil berulang (idempoten)', () => {
    vi.useFakeTimers();
    trackInterval(() => {}, 1000);
    clearAllIntervals();
    expect(() => clearAllIntervals()).not.toThrow();
    expect(activeIntervalCount()).toBe(0);
  });

  it('adversarial: clearAllIntervals saat tidak ada interval tidak melempar', () => {
    expect(() => clearAllIntervals()).not.toThrow();
    expect(activeIntervalCount()).toBe(0);
  });

  it('interval yang sudah di-clear tidak dieksekusi oleh timer', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    trackInterval(spy, 500);
    vi.advanceTimersByTime(600);
    expect(spy).toHaveBeenCalledTimes(1);
    clearAllIntervals();
    vi.advanceTimersByTime(2000);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
