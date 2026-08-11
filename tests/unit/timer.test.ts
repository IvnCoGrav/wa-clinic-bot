import { describe, it, expect, vi, afterEach } from 'vitest';
import { measure } from '../../src/utils/timer';

describe('measure() — timer aman untuk eksekusi paralel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mengembalikan hasil fn dan log durasi', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await measure('MY_LABEL', async () => 42);
    expect(result).toBe(42);
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^MY_LABEL#1 \d+\.\d{3}ms$/));
  });

  it('label unik (#1, #2) untuk invokasi paralel — tanpa warning collision', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await Promise.all([
      measure('PARALLEL_LABEL', async () => {
        await new Promise((r) => setTimeout(r, 30));
        return 'a';
      }),
      measure('PARALLEL_LABEL', async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 'b';
      }),
    ]);

    const labels = logSpy.mock.calls.map((c) => String(c[0]));
    expect(labels.some((l) => l.startsWith('PARALLEL_LABEL#1'))).toBe(true);
    expect(labels.some((l) => l.startsWith('PARALLEL_LABEL#2'))).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('timer tetap ditutup walau fn throw — tidak ada "No such label"', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      measure('THROW_LABEL', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^THROW_LABEL#\d+ \d+\.\d{3}ms$/));
  });
});
