import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queueService } from '../../src/services/queue.service';

describe('Queue Service Durability & Pause Handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('holds in-memory queued messages when queue is paused and drains upon resume', async () => {
    const phone = '628999888777';
    // Deterministik: paksa jalur in-memory dengan MEMUTUS Redis sungguhan
    // (jangan andalkan Redis kebetulan offline — bila Redis lokal hidup,
    // event 'ready' akan mengaktifkan ulang BullMQ dan test jadi goyah).
    await queueService.forceDisconnectRedis();
    expect(queueService.isRedisEnabled()).toBe(false);
    (queueService as any).memoryQueues.delete(phone);
    (queueService as any).memoryProcessing.delete(phone);

    const originalProcessNext = (queueService as any).processNextInMemory.bind(queueService);
    try {
      await queueService.pauseQueue();
      expect(queueService.isQueuePaused()).toBe(true);

      // Enqueue pesan saat paused — proses TIDAK boleh langsung berjalan.
      const processSpy = vi.fn();
      (queueService as any).processNextInMemory = processSpy;

      await queueService.enqueueMessage({
        tenantId: 'test-tenant',
        customerId: 'cust_1',
        phone,
        incomingMessage: { id: 'msg_1', text: { body: 'halo' } },
      });

      // Pesan tertahan di memoryQueues, belum diproses.
      const memQueue = (queueService as any).memoryQueues.get(phone);
      expect(memQueue).toBeDefined();
      expect(memQueue.length).toBe(1);
      expect(processSpy).not.toHaveBeenCalled();

      // Resume queue -> downstream processNextInMemory dipicu (drain).
      await queueService.resumeQueue();
      expect(queueService.isQueuePaused()).toBe(false);
      expect(processSpy).toHaveBeenCalledWith(phone);
    } finally {
      (queueService as any).processNextInMemory = originalProcessNext;
      (queueService as any).memoryQueues.delete(phone);
      (queueService as any).memoryProcessing.delete(phone);
      if (queueService.isQueuePaused()) await queueService.resumeQueue();
    }
  });

  it('ensureRedisOrThrow throws when QUEUE_REQUIRE_REDIS=true and Redis fails', async () => {
    const oldEnv = process.env.QUEUE_REQUIRE_REDIS;
    try {
      process.env.QUEUE_REQUIRE_REDIS = 'true';
      (queueService as any).redisInitPromise = Promise.resolve(false);

      await expect(queueService.ensureRedisOrThrow()).rejects.toThrow('FATAL_QUEUE_REDIS_REQUIRED');
    } finally {
      process.env.QUEUE_REQUIRE_REDIS = oldEnv;
    }
  });

  it('ensureRedisOrThrow succeeds when QUEUE_REQUIRE_REDIS=true and Redis is ready', async () => {
    const oldEnv = process.env.QUEUE_REQUIRE_REDIS;
    try {
      process.env.QUEUE_REQUIRE_REDIS = 'true';
      (queueService as any).redisInitPromise = Promise.resolve(true);

      await expect(queueService.ensureRedisOrThrow()).resolves.toBeUndefined();
    } finally {
      process.env.QUEUE_REQUIRE_REDIS = oldEnv;
    }
  });
});