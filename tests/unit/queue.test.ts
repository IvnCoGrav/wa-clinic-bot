import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { queueService, QueuePayload } from '../../src/services/queue.service';
import { stateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
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
    const processedCustomerIds: string[] = [];
    const processSpy = vi.spyOn(stateMachine, 'processMessage').mockImplementation(async (ctx) => {
      // Simulate state machine processing taking some time (50ms)
      await new Promise((resolve) => setTimeout(resolve, 50));
      processedIds.push(ctx.incomingMessage.id);
      processedCustomerIds.push(ctx.customer.id);
      return { nextState: 'INITIAL' as any, shouldSendReply: false };
    });

    const phone = '628123456789';
    // Seed customer asli lewat service (DB offline -> memory store) agar worker
    // benar-benar melewati jalur primer getCustomerById, bukan hanya fallback phone-lookup.
    const customer = await customerService.getOrCreateCustomer(phone, 'Test FIFO Customer', DEFAULT_TENANT_ID);
    expect(customer.id).toBeTruthy();

    const payloads: QueuePayload[] = Array.from({ length: 5 }, (_, i) => ({
      tenantId: DEFAULT_TENANT_ID,
      customerId: customer.id,
      phone,
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
    // Verify worker re-fetch customer fresh via getCustomerById (bukan snapshot payload):
    // ctx.customer.id harus sama dengan customer.id hasil getOrCreateCustomer.
    expect(processedCustomerIds).toEqual([customer.id, customer.id, customer.id, customer.id, customer.id]);
  });

  it('3. should fall back to In-Memory FIFO processing and continue processing correctly when Redis connection is forced offline', async () => {
    const processedIds: string[] = [];
    const processedCustomerIds: string[] = [];
    const processSpy = vi.spyOn(stateMachine, 'processMessage').mockImplementation(async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      processedIds.push(ctx.incomingMessage.id);
      processedCustomerIds.push(ctx.customer.id);
      return { nextState: 'INITIAL' as any, shouldSendReply: false };
    });

    // 1. Force disconnect Redis to simulate offline/failure mode
    await queueService.forceDisconnectRedis();
    expect(queueService.isRedisEnabled()).toBe(false);

    // 2. Dispatch 3 messages while Redis is offline
    const phone = '628999999999';
    // Seed customer asli lewat service agar worker melewati jalur getCustomerById.
    const customer = await customerService.getOrCreateCustomer(phone, 'Test Offline Customer', DEFAULT_TENANT_ID);
    expect(customer.id).toBeTruthy();

    const payloads: QueuePayload[] = Array.from({ length: 3 }, (_, i) => ({
      tenantId: DEFAULT_TENANT_ID,
      customerId: customer.id,
      phone,
      incomingMessage: { id: `offline_msg_${i + 1}`, text: { body: `Offline Message ${i + 1}` } },
    }));

    const promises = payloads.map(p => queueService.enqueueMessage(p));
    await Promise.all(promises);

    // Wait for in-memory queues to settle
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(processSpy).toHaveBeenCalledTimes(3);
    // Check that the in-memory queue fallback is strictly sequential and FIFO
    expect(processedIds).toEqual(['offline_msg_1', 'offline_msg_2', 'offline_msg_3']);
    // Verify worker re-fetch customer fresh via getCustomerById pada jalur in-memory fallback.
    expect(processedCustomerIds).toEqual([customer.id, customer.id, customer.id]);
  });

  it('4. should re-fetch fresh conversation state per job instead of using a stale snapshot (2 rapid affirmations)', async () => {
    const phone = '628555000111';
    const customer = await customerService.getOrCreateCustomer(phone, 'Stale State Customer', DEFAULT_TENANT_ID);
    expect(customer.id).toBeTruthy();

    // Seed lokasi tersimpan: customer punya kelurahan/lat/lng sehingga pesan afirmasi
    // "betul bund" di state INITIAL memajukan state ke AWAITING_INTEREST (greeting.ts).
    customer.kelurahan = 'Jambangan';
    customer.kecamatan = 'Jambangan';
    customer.lat = -7.34;
    customer.lng = 112.75;

    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    conversation.current_state = 'INITIAL';

    const statesSeen: string[] = [];
    const processSpy = vi.spyOn(stateMachine, 'processMessage').mockImplementation(async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      statesSeen.push(ctx.conversation.current_state);
      // Persist state ke memory store (meniru updateConversationState asli yang dipanggil
      // machine.ts) supaya job berikutnya membaca state hasil job ini.
      await conversationService.updateConversationState(
        ctx.conversation.id,
        { currentState: 'AWAITING_INTEREST' },
        DEFAULT_TENANT_ID
      );
      return { nextState: 'AWAITING_INTEREST' as any, shouldSendReply: false };
    });

    const enqueueMsg = (id: string, body: string) => queueService.enqueueMessage({
      tenantId: DEFAULT_TENANT_ID,
      customerId: customer.id,
      phone,
      incomingMessage: { id, from: phone, timestamp: '1700000000', type: 'text', text: { body } },
    });

    // 2 pesan afirmasi beruntun — pesan kedua harus diproses dengan state HASIL pesan
    // pertama, bukan snapshot state dari waktu enqueue.
    await Promise.all([enqueueMsg('stale_msg_1', 'betul bund'), enqueueMsg('stale_msg_2', 'betul bund')]);

    // Beri kesempatan worker in-memory menyelesaikan kedua job.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(processSpy).toHaveBeenCalledTimes(2);
    // Job kedua harus melihat current_state yang sudah berubah dari pesan pertama.
    expect(statesSeen).toEqual(['INITIAL', 'AWAITING_INTEREST']);
  });
});
