import { describe, it, expect, beforeEach } from 'vitest';
import {
  installLogBuffer,
  getLogBuffer,
  getLogBufferStats,
  isLogBufferInstalled,
} from '../../src/utils/log-buffer';

describe('Log Buffer (utils/log-buffer)', () => {
  beforeEach(() => {
    installLogBuffer();
  });

  it('menangkap console.log / warn / error', () => {
    console.log('hello-debug');
    console.warn('careful-debug');
    console.error('boom-debug');
    const entries = getLogBuffer(50, 'all');
    expect(entries.some((e) => e.level === 'log' && e.msg.includes('hello-debug'))).toBe(true);
    expect(entries.some((e) => e.level === 'warn' && e.msg.includes('careful-debug'))).toBe(true);
    expect(entries.some((e) => e.level === 'error' && e.msg.includes('boom-debug'))).toBe(true);
  });

  it('objek & Error diserialize aman', () => {
    console.log('obj-debug', { a: 1, b: 'x' }, new Error('kaboom-debug'));
    const hit = getLogBuffer(50, 'all').find((e) => e.msg.includes('obj-debug'));
    expect(hit).toBeTruthy();
    expect(hit!.msg).toContain('kaboom-debug');
    expect(hit!.msg).toContain('a');
  });

  it('filter level bekerja (terbaru duluan)', () => {
    console.error('only-error-xyz');
    const errs = getLogBuffer(10, 'error');
    expect(errs[0].level).toBe('error');
    const logs = getLogBuffer(10, 'log');
    expect(logs.some((e) => e.msg.includes('only-error-xyz'))).toBe(false);
  });

  it('stats menghitung per level', () => {
    console.log('stats-a-debug');
    console.warn('stats-b-debug');
    const s = getLogBufferStats();
    expect(s.log).toBeGreaterThan(0);
    expect(s.warn).toBeGreaterThan(0);
  });

  it('installed true setelah install, idempoten', () => {
    expect(isLogBufferInstalled()).toBe(true);
  });
});
