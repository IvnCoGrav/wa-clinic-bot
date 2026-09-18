import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queueService } from '../../src/services/queue.service';

describe('Queue Service Durability & Pause Handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('holds in-memory queued messages when queue is paused and drains upon resume', async () => {
    const phone = '628999888777';
    await queueService.pauseQueue();
    expect(queueService.isQueuePaused()).toBe(true);

    // Enqueue pesan saat paused
    const processSpy = vi.fn();
    (queueService as any).processNextInMemory = processSpy;

    await queueService.enqueueMessage({
      tenantId: 'test-tenant',
      customerId: 'cust_1',
      phone,
      incomingMessage: { id: 'msg_1', text: { body: 'halo' } },
    });

    // Pesan tertahan di memoryQueues
    const memQueue = (queueService as any).memoryQueues.get(phone);
    expect(memQueue).toBeDefined();
    expect(memQueue.length).toBe(1);

    // Resume queue -> downstream processNextInMemory dipicu
    await queueService.resumeQueue();
    expect(queueService.isQueuePaused()).toBe(false);
    expect(processSpy).toHaveBeenCalledWith(phone);
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