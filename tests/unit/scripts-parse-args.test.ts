import { describe, it, expect } from 'vitest';
import {
  parseCliArgs,
  getArgString,
  getArgNumber,
  getArgBoolean,
} from '../../src/scripts/lib/parse-args';

describe('Scripts CLI Arguments Parser (Fase 4-7)', () => {
  it('mem-parse argumen format --key=value secara presisi', () => {
    const argv = ['--tenant=tenant-abc', '--limit=50', '--export=/tmp/out.csv'];
    const parsed = parseCliArgs(argv);
    expect(parsed.tenant).toBe('tenant-abc');
    expect(parsed.limit).toBe('50');
    expect(parsed.export).toBe('/tmp/out.csv');
  });

  it('mem-parse argumen format --key value (spasi)', () => {
    const argv = ['--start', '2026-01-01', '--end', '2026-01-31', '--count', '100'];
    const parsed = parseCliArgs(argv);
    expect(parsed.start).toBe('2026-01-01');
    expect(parsed.end).toBe('2026-01-31');
    expect(parsed.count).toBe('100');
  });

  it('mem-parse boolean flags tanpa nilai sebagai boolean true', () => {
    const argv = ['--commit', '--dry-run', '--help'];
    const parsed = parseCliArgs(argv);
    expect(parsed.commit).toBe(true);
    expect(parsed['dry-run']).toBe(true);
    expect(parsed.help).toBe(true);
  });

  it('tidak menyerap argumen berikutnya jika flag adalah boolean', () => {
    const argv = ['--commit', '--tenant', 'tenant-123'];
    const parsed = parseCliArgs(argv);
    expect(parsed.commit).toBe(true);
    expect(parsed.tenant).toBe('tenant-123');
  });

  it('mengembalikan dictionary kosong untuk argv kosong', () => {
    expect(parseCliArgs([])).toEqual({});
  });

  describe('Helper getArgString, getArgNumber, getArgBoolean', () => {
    const parsed = parseCliArgs([
      '--tenant=kala-spa',
      '--days=14',
      '--invalid-num=abc',
      '--commit',
      '--enabled=true',
      '--disabled=false',
    ]);

    it('getArgString mengembalikan string atau fallback', () => {
      expect(getArgString(parsed, 'tenant', 'default')).toBe('kala-spa');
      expect(getArgString(parsed, 'missing', 'fallback-tenant')).toBe('fallback-tenant');
    });

    it('getArgNumber mengembalikan number atau fallback', () => {
      expect(getArgNumber(parsed, 'days', 7)).toBe(14);
      expect(getArgNumber(parsed, 'invalid-num', 10)).toBe(10);
      expect(getArgNumber(parsed, 'missing', 30)).toBe(30);
    });

    it('getArgBoolean mengembalikan boolean atau fallback', () => {
      expect(getArgBoolean(parsed, 'commit', false)).toBe(true);
      expect(getArgBoolean(parsed, 'enabled', false)).toBe(true);
      expect(getArgBoolean(parsed, 'disabled', true)).toBe(false);
      expect(getArgBoolean(parsed, 'missing', false)).toBe(false);
    });
  });
});
