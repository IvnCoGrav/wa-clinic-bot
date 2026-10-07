import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { queueService, QueuePayload } from '../../src/services/queue.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * FONDASIONAL (audit arsitektur Fase 1.1):
 * Kegagalan enqueue SATU pesan tidak boleh mematikan Redis secara permanen
 * (sticky downgrade). Flag `redisEnabled` hanya diubah oleh event koneksi
 * on('error')/on('ready'); catch enqueue cukup fallback in-memory per-pesan.
 *
 * Test ini menyuntikkan Queue palsu + flag Redis aktif agar perilaku dapat
 * diuji tanpa Redis/DB nyata (offline-first sesuai tests/setup.ts).
 */
describe('QueueService — fallback per-pesan (anti sticky downgrade)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (queueService as any).redisEnabled = false;
    (queueService as any).bullQueues?.clear?.();
  });

  afterEach(() => {
    (queueService as any).redisEnabled = false;
    (queueService as any).bullQueues?.clear?.();
  });

  it('kegagalan enqueue 1x TIDAK mematikan Redis; pesan berikutnya tetap dicoba ke BullMQ', async () => {
    const phone = '628123000111';
    const shardName = queueService.getShardQueueName(phone);

    const addMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Redis hiccup sementara'))
      .mockResolvedValueOnce({ id: 'ok' });

    (queueService as any).redisEnabled = true;
    (queueService as any).bullQueues.set(shardName, { add: addMock });

    const memorySpy = vi.spyOn(queueService as any, 'enqueueInMemory').mockImplementation(() => {});

    const mkPayload = (id: string): QueuePayload => ({
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-fallback',
      phone,
      incomingMessage: { id, text: { body: 'hai' } },
    });

    // Pesan 1: enqueue gagal → fallback in-memory untuk pesan ini, TAPI flag Redis tetap aktif.
    await queueService.enqueueMessage(mkPayload('fb-1'));
    expect(queueService.isRedisEnabled()).toBe(true);
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(memorySpy).toHaveBeenCalledTimes(1);

    // Pesan 2: Redis dianggap masih hidup → dicoba BullMQ lagi (bukan menyerah permanen).
    await queueService.enqueueMessage(mkPayload('fb-2'));
    expect(addMock).toHaveBeenCalledTimes(2);
    // Pesan 2 sukses di BullMQ → TIDAK ikut masuk in-memory.
    expect(memorySpy).toHaveBeenCalledTimes(1);
    expect(queueService.isRedisEnabled()).toBe(true);
  });

  it('saat Redis benar-benar offline (flag false), pesan tetap masuk in-memory queue', async () => {
    const phone = '628123000222';
    const memorySpy = vi.spyOn(queueService as any, 'enqueueInMemory').mockImplementation(() => {});
    (queueService as any).redisEnabled = false;

    await queueService.enqueueMessage({
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-offline',
      phone,
      incomingMessage: { id: 'off-1', text: { body: 'hai' } },
    });

    expect(queueService.isRedisEnabled()).toBe(false);
    expect(memorySpy).toHaveBeenCalledTimes(1);
  });
});
