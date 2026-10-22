import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { queueService, QueuePayload, resolveQueueJobId, shouldRunChatConsumers } from '../../src/services/queue.service';
import { stateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { turnRepository } from '../../src/repositories/turn.repository';

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
    await new Promise((resolve) => setTimeout(resolve, 600));

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

    // Wait for in-memory queues to settle with resilient polling
    await vi.waitFor(() => {
      expect(processSpy).toHaveBeenCalledTimes(3);
      expect(processedIds).toEqual(['offline_msg_1', 'offline_msg_2', 'offline_msg_3']);
    }, { timeout: 3000, interval: 20 });

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

  // R3 — kunci dedup kanonis: stabil bila ada ID, unik bila tidak ada.
  it('R3. turnId kanonis dipakai sebagai jobId (dedup stabil retry)', () => {
    const base: QueuePayload = {
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      phone: '628111',
      incomingMessage: { id: 'wamid.X' },
      turnId: 'default-tenant:WAHA:wamid.X',
      inboundMessageId: 'wamid.X',
    };
    expect(resolveQueueJobId('628111', base)).toBe('job_628111_default-tenant:WAHA:wamid.X');
    expect(resolveQueueJobId('628111', base)).toBe(resolveQueueJobId('628111', base));
  });

  it('R3. tanpa ID apa pun jobId unik (tidak pernah drop pesan sah sebagai duplikat)', () => {
    const mk = (): QueuePayload => ({
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      phone: '628111',
      incomingMessage: {},
    });
    const a = resolveQueueJobId('628111', mk());
    const b = resolveQueueJobId('628111', mk());
    expect(a).not.toContain('undefined');
    expect(a).not.toBe(b);
  });

  it('R3b. turnId sama yang di-enqueue dua kali hanya diproses sekali', async () => {
    const claimSpy = vi
      .spyOn(turnRepository, 'claimForProcessing')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const processSpy = vi
      .spyOn(stateMachine, 'processMessage')
      .mockResolvedValue({ nextState: 'INITIAL' as any, shouldSendReply: false });

    const svc = queueService as any;
    const prevEnabled = svc.redisEnabled;
    const prevClient = svc.redisClient;
    svc.redisEnabled = false;
    svc.redisClient = null;

    try {
      const phone = '628777111222';
      const customer = await customerService.getOrCreateCustomer(phone);
      const payload: QueuePayload = {
        tenantId: DEFAULT_TENANT_ID,
        customerId: customer.id,
        phone,
        provider: 'WAHA',
        inboundMessageId: 'msg-dup-1',
        turnId: 'default-tenant:WAHA:msg-dup-1',
        incomingMessage: { id: 'msg-dup-1', from: phone, timestamp: '1700000000', type: 'text', text: { body: 'halo' } },
      };

      await Promise.all([
        queueService.enqueueMessage(payload),
        queueService.enqueueMessage(payload),
      ]);

      await vi.waitFor(() => {
        expect(claimSpy).toHaveBeenCalledTimes(2);
      }, { timeout: 2000 });

      expect(processSpy).toHaveBeenCalledTimes(1);
    } finally {
      svc.redisEnabled = prevEnabled;
      svc.redisClient = prevClient;
    }
  });

  // Insiden balasan ganda 12/10/2026 — kunci in-flight terdistribusi.
  it('F4.1. acquirePhoneLock fallback in-memory saat Redis offline: lock → busy → release → lock lagi', async () => {
    const svc = queueService as any;
    const prevEnabled = svc.redisEnabled;
    const prevClient = svc.redisClient;
    svc.redisEnabled = false;
    svc.redisClient = null;
    try {
      const key = 'lock:default-tenant:62899000111';
      expect(await queueService.acquirePhoneLock(key, 'uuid-A')).toBe('memory');
      expect(await queueService.acquirePhoneLock(key, 'uuid-B')).toBe('busy');
      await queueService.releasePhoneLock(key, null);
      expect(await queueService.acquirePhoneLock(key, 'uuid-C')).toBe('memory');
      await queueService.releasePhoneLock(key, null);
    } finally {
      svc.redisEnabled = prevEnabled;
      svc.redisClient = prevClient;
    }
  });

  it('F4.2. acquirePhoneLock Redis: NX dipatuhi, release hanya oleh pemilik (Lua)', async () => {
    const svc = queueService as any;
    const prevEnabled = svc.redisEnabled;
    const prevClient = svc.redisClient;
    // Fake Redis sekecil mungkin: SET NX EX + EVAL banding-dan-hapus.
    const store = new Map<string, string>();
    const fake = {
      set: async (k: string, v: string, _ex: string, _ttl: number, nx: string) => {
        if (nx === 'NX' && store.has(k)) return null;
        store.set(k, v);
        return 'OK';
      },
      eval: async (_script: string, _n: number, k: string, token: string) => {
        if (store.get(k) === token) {
          store.delete(k);
          return 1;
        }
        return 0;
      },
    };
    svc.redisEnabled = true;
    svc.redisClient = fake;
    try {
      const key = 'lock:tenant-Z:62899000222';
      expect(await queueService.acquirePhoneLock(key, 'owner-1')).toBe('redis');
      // Pemilik lain ditolak selama lock aktif.
      expect(await queueService.acquirePhoneLock(key, 'owner-2')).toBe('busy');
      // Release oleh BUKAN pemilik tidak menghapus lock.
      await queueService.releasePhoneLock(key, 'owner-2');
      expect(await queueService.acquirePhoneLock(key, 'owner-3')).toBe('busy');
      // Release oleh pemilik membuka lock.
      await queueService.releasePhoneLock(key, 'owner-1');
      expect(await queueService.acquirePhoneLock(key, 'owner-3')).toBe('redis');
      await queueService.releasePhoneLock(key, 'owner-3');
    } finally {
      svc.redisEnabled = prevEnabled;
      svc.redisClient = prevClient;
    }
  });

  it('F4.3. kunci tenant-aware: nomor sama beda tenant tidak saling mengunci', async () => {
    const svc = queueService as any;
    const prevEnabled = svc.redisEnabled;
    const prevClient = svc.redisClient;
    svc.redisEnabled = false;
    svc.redisClient = null;
    try {
      expect(await queueService.acquirePhoneLock('lock:tenant-A:62899', 't1')).toBe('memory');
      expect(await queueService.acquirePhoneLock('lock:tenant-B:62899', 't2')).toBe('memory');
      await queueService.releasePhoneLock('lock:tenant-A:62899', null);
      await queueService.releasePhoneLock('lock:tenant-B:62899', null);
    } finally {
      svc.redisEnabled = prevEnabled;
      svc.redisClient = prevClient;
    }
  });

  // Insiden kebocoran worker 12/10/2026 — dedicated worker dilarang menjadi
  // konsumen chat (hanya produsen enqueue); selain itu tetap konsumen.
  it('F1.1. shouldRunChatConsumers: worker bukan konsumen, app/monolith ya', () => {
    const prev = process.env.SEPARATE_WORKER;
    try {
      delete process.env.SEPARATE_WORKER;
      expect(shouldRunChatConsumers()).toBe(true);
      process.env.SEPARATE_WORKER = 'false';
      expect(shouldRunChatConsumers()).toBe(true);
      process.env.SEPARATE_WORKER = 'true';
      expect(shouldRunChatConsumers()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.SEPARATE_WORKER;
      else process.env.SEPARATE_WORKER = prev;
    }
  });
});
