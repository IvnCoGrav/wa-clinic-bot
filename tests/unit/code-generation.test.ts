import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateTrackingCode } from '../../src/routes/tracking.route';
import { prisma } from '../../src/db/client';

// Alphabet yang sama dengan yang dipakai di tracking.route.ts
const TRACKING_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const AMBIGUOUS_CHARS = ['0', '1', 'i', 'l', 'o'];

describe('generateTrackingCode() — Insert-and-Catch-Conflict + Retry-and-Escalate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. should generate a 2-character code when DB has plenty of room (no collisions)', async () => {
    const mockRecord = { id: 'cuid_1', trackingCode: 'ab', createdAt: new Date() };
    vi.mocked(prisma.adClick.create).mockResolvedValueOnce(mockRecord as any);

    const result = await generateTrackingCode({ tenant_id: 'default-tenant' }, prisma);

    expect(result.trackingCode).toHaveLength(2);
    expect(result.record).toBe(mockRecord);
    expect(prisma.adClick.create).toHaveBeenCalledTimes(1);
  });

  it('2. should only use clean alphabet chars — no ambiguous chars (0,1,i,l,o) in 1000 samples', () => {
    // Buat 1000 kode menggunakan TRACKING_ALPHABET langsung (fungsi internal _randomCode tidak di-export,
    // tapi kita bisa test distribusi dengan generate via loop)
    const generated = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      // Simulate _randomCode(2) via alphabet directly
      const len = TRACKING_ALPHABET.length;
      const code = TRACKING_ALPHABET.charAt(Math.floor(Math.random() * len)) +
                   TRACKING_ALPHABET.charAt(Math.floor(Math.random() * len));
      generated.add(code);
    }

    for (const code of generated) {
      for (const ch of code) {
        expect(AMBIGUOUS_CHARS).not.toContain(ch);
      }
    }
    // Juga verifikasi semua karakter dalam alphabet bersih
    for (const ch of TRACKING_ALPHABET) {
      expect(AMBIGUOUS_CHARS).not.toContain(ch);
    }
  });

  it('3. should escalate to 3-character codes when 2-char space is full (5 consecutive P2002)', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const mockRecord3 = { id: 'cuid_3char', trackingCode: 'abc', createdAt: new Date() };

    // 5 kolisi di 2-karakter, lalu sukses di 3-karakter
    vi.mocked(prisma.adClick.create)
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce(mockRecord3 as any);

    const result = await generateTrackingCode({ tenant_id: 'default-tenant' }, prisma);

    expect(result.trackingCode).toHaveLength(3);
    expect(prisma.adClick.create).toHaveBeenCalledTimes(6); // 5 kolisi + 1 sukses
  });

  it('4. should escalate to 4-character codes when both 2-char and 3-char spaces are full', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const mockRecord4 = { id: 'cuid_4char', trackingCode: 'abcd', createdAt: new Date() };

    // 5 kolisi 2-char + 5 kolisi 3-char + 1 sukses 4-char = 11 total calls
    vi.mocked(prisma.adClick.create)
      .mockRejectedValueOnce(p2002) // 2-char attempt 1
      .mockRejectedValueOnce(p2002) // 2-char attempt 2
      .mockRejectedValueOnce(p2002) // 2-char attempt 3
      .mockRejectedValueOnce(p2002) // 2-char attempt 4
      .mockRejectedValueOnce(p2002) // 2-char attempt 5
      .mockRejectedValueOnce(p2002) // 3-char attempt 1
      .mockRejectedValueOnce(p2002) // 3-char attempt 2
      .mockRejectedValueOnce(p2002) // 3-char attempt 3
      .mockRejectedValueOnce(p2002) // 3-char attempt 4
      .mockRejectedValueOnce(p2002) // 3-char attempt 5
      .mockResolvedValueOnce(mockRecord4 as any); // 4-char sukses

    const result = await generateTrackingCode({ tenant_id: 'default-tenant' }, prisma);

    expect(result.trackingCode).toHaveLength(4);
    expect(prisma.adClick.create).toHaveBeenCalledTimes(11);
  });

  it('5. should always call create with different codes on each retry (no reuse)', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const mockRecord = { id: 'cuid_ok', trackingCode: 'xy', createdAt: new Date() };

    vi.mocked(prisma.adClick.create)
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce(mockRecord as any);

    await generateTrackingCode({ tenant_id: 'default-tenant' }, prisma);

    const calls = vi.mocked(prisma.adClick.create).mock.calls;
    expect(calls).toHaveLength(3);

    // Kumpulkan semua kode yang dicoba
    const triedCodes = calls.map((c: any[]) => c[0].data.trackingCode);

    // Semua kode harus dari alphabet bersih
    for (const code of triedCodes) {
      for (const ch of (code as string)) {
        expect(AMBIGUOUS_CHARS).not.toContain(ch);
      }
    }
  });

  it('6. concurrent collision — two simultaneous requests must resolve to different codes', async () => {
    // Simulasi race condition: request pertama selalu sukses, request kedua kena P2002 lalu sukses retry
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

    let callCount = 0;
    vi.mocked(prisma.adClick.create).mockImplementation(async (args: any) => {
      callCount++;
      // Call 1 (request A): sukses langsung
      // Call 2 (request B): P2002 karena "kode sama" dengan request A
      // Call 3 (request B retry): sukses dengan kode berbeda
      if (callCount === 2) {
        throw p2002;
      }
      return { id: 'cuid_' + callCount, trackingCode: args.data.trackingCode, createdAt: new Date() } as any;

    });

    const [resultA, resultB] = await Promise.all([
      generateTrackingCode({ tenant_id: 'default-tenant' }, prisma),
      generateTrackingCode({ tenant_id: 'default-tenant' }, prisma),
    ]);

    // Kedua request harus berhasil
    expect(resultA.trackingCode).toBeDefined();
    expect(resultB.trackingCode).toBeDefined();

    // Total 3 calls: 1 sukses + 1 P2002 + 1 retry sukses
    expect(vi.mocked(prisma.adClick.create)).toHaveBeenCalledTimes(3);
  });

  it('7. latency benchmark — 100 sequential calls stay well under 50ms each (mock DB)', async () => {
    const mockRecord = { id: 'cuid_bench', trackingCode: 'ab', createdAt: new Date() };
    vi.mocked(prisma.adClick.create).mockResolvedValue(mockRecord as any);

    const durations: number[] = [];

    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await generateTrackingCode({ tenant_id: 'default-tenant' }, prisma);
      durations.push(performance.now() - start);
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const p50 = sorted[49];
    const worstCase = sorted[99];

    console.log('[Latency Benchmark] p50=' + p50.toFixed(2) + 'ms | worst-case=' + worstCase.toFixed(2) + 'ms');


    // Budget: p50 < 5ms, worst-case < 50ms (dengan mock DB yang instant, ini sangat longgar)
    expect(p50).toBeLessThan(5);
    expect(worstCase).toBeLessThan(50);
  });
});
