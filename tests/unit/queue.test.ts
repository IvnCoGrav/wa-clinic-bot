import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { queueService, QueuePayload } from '../../src/services/queue.service';
import { stateMachine } from '../../src/state-machine/machine';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Message Queue Service Unit Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await queueService.close();
  });

  it('1. should prove that sharding is fully deterministic (same phone always maps to same shard queue)', () => {
    const phoneA = '628123456789';
    const phoneB = '628999888777';

    const shardA1 = queueService.getShardQueueName(phoneA);
    const shardA2 = queueService.getShardQueueName(phoneA);
    const shardB1 = queueService.getShardQueueName(phoneB);

    // Deterministic checks
    expect(shardA1).toBe(shardA2);
    expect(shardA1).toContain('message_queue_shard_');
    
    // Different phone numbers might end up in same or different queues depending on hash modulo,
    // but the mapping for each specific number is always constant.
    const manyShards = Array.from({ length: 50 }, (_, i) => queueService.getShardQueueName(`62811${i}`));
    manyShards.forEach(shard => {
      expect(shard).toMatch(/^message_queue_shard_\d+$/);
    });
  });

  it('2. should process multiple messages from a single customer sequentially (FIFO) to prevent race conditions', async () => {
    const processedIds: string[] = [];
    const processSpy = vi.spyOn(stateMachine, 'processMessage').mockImplementation(async (ctx) => {
      // Simulate state machine processing taking some time (50ms)
      await new Promise((resolve) => setTimeout(resolve, 50));
      processedIds.push(ctx.incomingMessage.id);
      return { nextState: 'INITIAL' as any, shouldSendReply: false };
    });

    const phone = '628123456789';
    const payloads: QueuePayload[] = Array.from({ length: 5 }, (_, i) => ({
      tenantId: DEFAULT_TENANT_ID,
      customer: { phone },
      conversation: { id: 'conv_123' },
      incomingMessage: { id: `msg_${i + 1}`, text: { body: `Message ${i + 1}` } },
    }));

    // Enqueue all 5 messages rapidly (simultaneous dispatch)
    const promises = payloads.map(p => queueService.enqueueMessage(p));
    await Promise.all(promises);

    // Wait a brief moment to let the loop execute
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(processSpy).toHaveBeenCalledTimes(5);
    // Verify FIFO processing order: msg_1, msg_2, msg_3, msg_4, msg_5
    expect(processedIds).toEqual(['msg_1', 'msg_2', 'msg_3', 'msg_4', 'msg_5']);
  });

  it('3. should fall back to In-Memory FIFO processing and continue processing correctly when Redis connection is forced offline', async () => {
    const processedIds: string[] = [];
    const processSpy = vi.spyOn(stateMachine, 'processMessage').mockImplementation(async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      processedIds.push(ctx.incomingMessage.id);
      return { nextState: 'INITIAL' as any, shouldSendReply: false };
    });

    // 1. Force disconnect Redis to simulate offline/failure mode
    await queueService.forceDisconnectRedis();
    expect(queueService.isRedisEnabled()).toBe(false);

    // 2. Dispatch 3 messages while Redis is offline
    const phone = '628999999999';
    const payloads: QueuePayload[] = Array.from({ length: 3 }, (_, i) => ({
      tenantId: DEFAULT_TENANT_ID,
      customer: { phone },
      conversation: { id: 'conv_offline' },
      incomingMessage: { id: `offline_msg_${i + 1}`, text: { body: `Offline Message ${i + 1}` } },
    }));

    const promises = payloads.map(p => queueService.enqueueMessage(p));
    await Promise.all(promises);

    // Wait for in-memory queues to settle
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(processSpy).toHaveBeenCalledTimes(3);
    // Check that the in-memory queue fallback is strictly sequential and FIFO
    expect(processedIds).toEqual(['offline_msg_1', 'offline_msg_2', 'offline_msg_3']);
  });
});
