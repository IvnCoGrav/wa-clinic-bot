import { describe, it, expect, beforeEach } from 'vitest';
import { ClientIdempotencyStore } from '../../src/utils/client-idempotency';
import { DistributedKv } from '../../src/utils/distributed-kv';

/**
 * UTL-15: idempotensi `clientTempId` harus terlihat lintas proses.
 * Dua store berbeda (mensimulasikan app & worker) berbagi satu backend KV.
 */
describe('ClientIdempotencyStore lintas proses (UTL-15)', () => {
  let kv: DistributedKv;

  beforeEach(() => {
    kv = new DistributedKv({ forceMemory: true });
  });

  it('hasil kirim dari proses A terbaca oleh proses B', async () => {
    const procA = new ClientIdempotencyStore(60_000, 100, kv, 'idem-test');
    const procB = new ClientIdempotencyStore(60_000, 100, kv, 'idem-test');

    await procA.setAsync('temp-1', { messageId: 'wa-1', id: 'db-1' });
    const seenByB = await procB.getAsync('temp-1');

    expect(seenByB).toMatchObject({ messageId: 'wa-1', id: 'db-1' });
  });

  it('namespace berbeda tidak saling bocor', async () => {
    const a = new ClientIdempotencyStore(60_000, 100, kv, 'ns-a');
    const b = new ClientIdempotencyStore(60_000, 100, kv, 'ns-b');

    await a.setAsync('temp-2', { messageId: 'wa-a' });
    expect(await b.getAsync('temp-2')).toBeNull();
  });

  it('entri kedaluwarsa tidak dikembalikan (TTL lokal & TTL KV)', async () => {
    const store = new ClientIdempotencyStore(1_000, 100, kv, 'idem-ttl');
    const now = 5_000;
    await store.setAsync('temp-3', { messageId: 'wa-3' }, now);

    expect(await store.getAsync('temp-3', now + 999)).not.toBeNull();
    expect(await store.getAsync('temp-3', now + 1_001)).toBeNull();
  });

  it('key kosong/null tidak menyentuh KV', async () => {
    const store = new ClientIdempotencyStore(60_000, 100, kv, 'idem-null');
    expect(await store.getAsync(null)).toBeNull();
    expect(await store.getAsync('')).toBeNull();
    await expect(store.setAsync(undefined, { messageId: 'x' })).resolves.toBeUndefined();
  });

  it('data rusak di KV tidak melempar (fail-safe)', async () => {
    const store = new ClientIdempotencyStore(60_000, 100, kv, 'idem-corrupt');
    await kv.set('idem-corrupt:temp-4', '{bukan-json', 60_000);
    await expect(store.getAsync('temp-4')).resolves.toBeNull();
  });

  it('getAsync tetap memakai cache lokal lebih dulu', async () => {
    const store = new ClientIdempotencyStore(60_000, 100, kv, 'idem-local');
    store.set('temp-5', { messageId: 'lokal' });
    expect(await store.getAsync('temp-5')).toMatchObject({ messageId: 'lokal' });
  });
});
