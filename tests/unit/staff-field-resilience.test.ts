import { describe, it, expect } from 'vitest';
import { createMonotonicSseSequencer } from '../../src/utils/sse-sequence';
import { ClientIdempotencyStore } from '../../src/utils/client-idempotency';
import {
  IMAGE_COMPRESS_PROFILES,
  resolveCompressProfile,
} from '../../packages/admin-dashboard/src/utils/imageCompressor';

/**
 * Fase 4.1 — Ketahanan lapangan (sinyal 1-bar). Adversial, bukan happy-path:
 * menguji gap deteksi SSE, idempotensi retry lintas timeout, dan batas ukuran
 * profil kompresi foto lapangan. Semua murni/offline (tanpa DB/network).
 */

describe('SSE monotonic sequencer (Fase 0.4)', () => {
  it('memberikan id yang selalu naik (tanpa duplikat)', () => {
    const seq = createMonotonicSseSequencer(1000);
    const ids = [seq.next(), seq.next(), seq.next()];
    expect(ids).toEqual(['1001', '1002', '1003']);
    const nums = ids.map(Number);
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i]).toBeGreaterThan(nums[i - 1]);
    }
  });

  it('dua sequencer (staff & admin) tetap monotonik internal', () => {
    const a = createMonotonicSseSequencer(0);
    const b = createMonotonicSseSequencer(0);
    expect(Number(a.next())).toBe(1);
    expect(Number(a.next())).toBe(2);
    expect(Number(b.next())).toBe(1);
  });

  it('mendeteksi gap saat tab tidur lalu bangun (id melompat)', () => {
    const seq = createMonotonicSseSequencer(0);
    const seen: number[] = [];
    let lastReceived: number | null = null;
    let gapDetected = false;
    const consume = (id: string) => {
      const n = Number(id);
      if (lastReceived != null && n > lastReceived + 1) gapDetected = true;
      lastReceived = n;
      seen.push(n);
    };
    consume(seq.next());
    // event berikutnya "hilang": server mengeluarkan 2 id, klien hanya menerima yang kedua
    seq.next();
    consume(seq.next());
    expect(gapDetected).toBe(true);
    expect(seen).toEqual([1, 3]);
  });
});

describe('Idempotensi retry balasan terapis (Fase 1.2)', () => {
  it('retry dengan clientTempId sama mengembalikan hasil pertama (anti dobel kirim)', () => {
    const store = new ClientIdempotencyStore(5 * 60 * 1000);
    store.set('tmp-abc', { messageId: 'wa_1', id: 'msg_1' }, 1000);
    const hit = store.get('tmp-abc', 1000 + 60_000);
    expect(hit).toEqual({ at: 1000, messageId: 'wa_1', id: 'msg_1' });
  });

  it('clientTempId tanpa hasil → null (dikirim normal)', () => {
    const store = new ClientIdempotencyStore();
    expect(store.get('belum-pernah', 0)).toBeNull();
    expect(store.get(null, 0)).toBeNull();
  });

  it('setelah TTL 5 menit → entri kedaluwarsa (boleh dikirim baru)', () => {
    const store = new ClientIdempotencyStore(5 * 60 * 1000);
    store.set('tmp-abc', { messageId: 'wa_1' }, 0);
    expect(store.get('tmp-abc', 5 * 60 * 1000 - 1)).not.toBeNull();
    expect(store.get('tmp-abc', 5 * 60 * 1000)).toBeNull();
  });

  it('menjaga batas memori (maxEntries) dengan buang entri tertua', () => {
    const store = new ClientIdempotencyStore(60_000, 3);
    store.set('a', { messageId: '1' }, 1);
    store.set('b', { messageId: '2' }, 2);
    store.set('c', { messageId: '3' }, 3);
    store.set('d', { messageId: '4' }, 4);
    expect(store.size()).toBeLessThanOrEqual(3);
    // entri paling tua ('a') dibuang, yang baru tetap ada
    expect(store.get('a', 5)).toBeNull();
    expect(store.get('d', 5)).not.toBeNull();
  });
});

describe('Profil kompresi foto lapangan (Fase 2.2)', () => {
  it('profil field <= 960px & kualitas < chat (agresif untuk sinyal 1-bar)', () => {
    const field = resolveCompressProfile('field');
    const chat = resolveCompressProfile('chat');
    expect(field.maxWidth).toBeLessThanOrEqual(960);
    expect(field.maxHeight).toBeLessThanOrEqual(960);
    expect(field.quality).toBeLessThan(chat.quality);
    expect(field.quality).toBeGreaterThan(0);
    expect(field.quality).toBeLessThanOrEqual(1);
  });

  it('semua profil memiliki dimensi & kualitas valid', () => {
    for (const key of Object.keys(IMAGE_COMPRESS_PROFILES) as Array<keyof typeof IMAGE_COMPRESS_PROFILES>) {
      const p = IMAGE_COMPRESS_PROFILES[key];
      expect(p.maxWidth).toBeGreaterThan(0);
      expect(p.maxHeight).toBeGreaterThan(0);
      expect(p.quality).toBeGreaterThan(0);
      expect(p.quality).toBeLessThanOrEqual(1);
    }
  });
});
