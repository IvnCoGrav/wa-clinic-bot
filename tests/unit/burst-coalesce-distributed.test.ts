import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { BurstCoalesceService } from '../../src/services/burst-coalesce.service';
import { queueService } from '../../src/services/queue.service';
import { messageService } from '../../src/services/message.service';
import { DistributedKv } from '../../src/utils/distributed-kv';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * W-006: dua instance service (app & worker) berbagi buffer di KV.
 * Yang diuji adalah perilaku nyata: burst yang sama HARUS menghasilkan satu job.
 */

function makeMsg(id: string, body: string, extra: any = {}) {
  return {
    id,
    from: '628123456789',
    chatId: '628123456789@c.us',
    timestamp: '1700000000',
    type: 'text',
    text: { body },
    ...extra,
  };
}

function makeConv(state: ConversationState) {
  return { id: `conv_${Math.random().toString(36).substring(7)}`, current_state: state };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('BurstCoalesceService lintas proses (W-006)', () => {
  let kv: DistributedKv;
  let appInstance: BurstCoalesceService;
  let workerInstance: BurstCoalesceService;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.BURST_COALESCE_MS = '50';
    process.env.BURST_COALESCE_MAX_MESSAGES = '10';
    kv = new DistributedKv({ forceMemory: true });
    appInstance = new BurstCoalesceService(kv, true);
    workerInstance = new BurstCoalesceService(kv, true);
  });

  afterEach(async () => {
    await appInstance.flushAll();
    await workerInstance.flushAll();
  });

  it('pesan masuk ke instance berbeda tetap menjadi satu job gabungan', async () => {
    const enqueueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);
    const logSpy = vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

    const conv = makeConv(ConversationState.INITIAL);
    const base = { tenantId: DEFAULT_TENANT_ID, customerId: 'cust-1', phone: '628111222333' };

    const r1 = await appInstance.maybeCoalesce({
      ...base,
      conversation: conv,
      incomingMessage: makeMsg('m1', 'halo bunda'),
    });
    const r2 = await workerInstance.maybeCoalesce({
      ...base,
      conversation: conv,
      incomingMessage: makeMsg('m2', 'pijat bayi berapa?'),
    });

    expect(r1.handled).toBe(true);
    expect(r2.handled).toBe(true);
    expect(logSpy).toHaveBeenCalledTimes(2);

    await settle(160);

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const payload = enqueueSpy.mock.calls[0][0];
    expect(payload.incomingMessage._mergedCount).toBe(2);
    expect(payload.incomingMessage._preLogged).toBe(true);
    expect(payload.incomingMessage.text.body).toBe('halo bunda\npijat bayi berapa?');
  });

  it('dua timer yang jatuh bersamaan tidak menghasilkan dua job (lock)', async () => {
    const enqueueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);
    vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

    const conv = makeConv(ConversationState.AWAITING_LOCATION);
    const base = { tenantId: DEFAULT_TENANT_ID, customerId: 'cust-1', phone: '628444555666' };

    // Kedua instance menerima pesan pada waktu hampir sama → dua timer lokal.
    await Promise.all([
      appInstance.maybeCoalesce({
        ...base,
        conversation: conv,
        incomingMessage: makeMsg('m1', 'Taman wisata Regency'),
      }),
      workerInstance.maybeCoalesce({
        ...base,
        conversation: conv,
        incomingMessage: makeMsg('m2', 'Gadung'),
      }),
    ]);

    await settle(180);

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0][0].incomingMessage.text.body).toBe(
      'Taman wisata Regency\nGadung'
    );
  });

  it('non-coalesceable (location) mem-flush buffer lintas instance lalu passthrough', async () => {
    const enqueueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);
    vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

    const conv = makeConv(ConversationState.AWAITING_LOCATION);
    const base = { tenantId: DEFAULT_TENANT_ID, customerId: 'cust-1', phone: '628777888999' };

    await appInstance.maybeCoalesce({
      ...base,
      conversation: conv,
      incomingMessage: makeMsg('m1', 'saya di sini'),
    });

    const r = await workerInstance.maybeCoalesce({
      ...base,
      conversation: conv,
      incomingMessage: {
        id: 'm2',
        from: base.phone,
        chatId: `${base.phone}@c.us`,
        type: 'location',
        location: { latitude: -7.3, longitude: 112.7 },
      },
    });

    expect(r.handled).toBe(false);
    await settle(30);

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0][0].incomingMessage.text.body).toBe('saya di sini');
  });

  it('max messages lintas instance langsung memicu flush', async () => {
    process.env.BURST_COALESCE_MAX_MESSAGES = '2';
    const enqueueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);
    vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

    const conv = makeConv(ConversationState.INITIAL);
    const base = { tenantId: DEFAULT_TENANT_ID, customerId: 'cust-1', phone: '628000111222' };

    await appInstance.maybeCoalesce({
      ...base,
      conversation: conv,
      incomingMessage: makeMsg('m1', 'a'),
    });
    await workerInstance.maybeCoalesce({
      ...base,
      conversation: conv,
      incomingMessage: makeMsg('m2', 'b'),
    });

    await settle(40);

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0][0].incomingMessage.text.body).toBe('a\nb');
  });

  it('buffer bersama tidak bocor ke tenant/nomor lain', async () => {
    const enqueueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);
    vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

    const conv = makeConv(ConversationState.INITIAL);

    await appInstance.maybeCoalesce({
      tenantId: 'tenant-a',
      customerId: 'cust-a',
      phone: '628111000111',
      conversation: conv,
      incomingMessage: makeMsg('m1', 'pesan tenant A'),
    });
    await workerInstance.maybeCoalesce({
      tenantId: 'tenant-b',
      customerId: 'cust-b',
      phone: '628111000111',
      conversation: conv,
      incomingMessage: makeMsg('m2', 'pesan tenant B'),
    });

    await settle(160);

    expect(enqueueSpy).toHaveBeenCalledTimes(2);
    const bodies = enqueueSpy.mock.calls.map((c) => c[0].incomingMessage.text.body).sort();
    expect(bodies).toEqual(['pesan tenant A', 'pesan tenant B']);
  });
});
