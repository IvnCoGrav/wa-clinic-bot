import { describe, it, expect } from 'vitest';
import { TtlCache, resolveTtlMs } from '../../src/utils/ttl-cache';

describe('TtlCache (W-009)', () => {
  it('mengembalikan nilai sebelum TTL habis', () => {
    let now = 1_000;
    const cache = new TtlCache<string, string>({ ttlMs: 5_000, now: () => now });
    cache.set('p1', 'tenant-a');
    now = 5_999;
    expect(cache.get('p1')).toBe('tenant-a');
  });

  it('menghapus nilai setelah TTL habis (reassignment tenant terbaca)', () => {
    let now = 1_000;
    const cache = new TtlCache<string, string>({ ttlMs: 5_000, now: () => now });
    cache.set('p1', 'tenant-a');
    now = 6_000;
    expect(cache.get('p1')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('TTL per-key independen (key lain tidak ikut kedaluwarsa)', () => {
    let now = 0;
    const cache = new TtlCache<string, string>({ ttlMs: 1_000, now: () => now });
    cache.set('p1', 'tenant-a');
    now = 500;
    cache.set('p2', 'tenant-b');
    now = 1_200;
    expect(cache.get('p1')).toBeUndefined();
    expect(cache.get('p2')).toBe('tenant-b');
  });

  it('delete/clear membuang entri secara deterministik', () => {
    const cache = new TtlCache<string, string>({ ttlMs: 60_000 });
    cache.set('p1', 'tenant-a');
    cache.set('p2', 'tenant-b');
    expect(cache.delete('p1')).toBe(true);
    expect(cache.get('p1')).toBeUndefined();
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('TTL tidak valid jatuh ke default aman, bukan cache abadi', () => {
    let now = 0;
    const cache = new TtlCache<string, string>({ ttlMs: 0, now: () => now });
    cache.set('p1', 'tenant-a');
    now = 300_001;
    expect(cache.get('p1')).toBeUndefined();
  });

  it('resolveTtlMs membaca env dan menolak nilai tidak wajar', () => {
    expect(resolveTtlMs('120000')).toBe(120_000);
    expect(resolveTtlMs(undefined)).toBe(300_000);
    expect(resolveTtlMs('0')).toBe(300_000);
    expect(resolveTtlMs('abc')).toBe(300_000);
  });
});
