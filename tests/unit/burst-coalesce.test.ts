import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { burstCoalesceService } from '../../src/services/burst-coalesce.service';
import { queueService } from '../../src/services/queue.service';
import { messageService } from '../../src/services/message.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Test Burst Coalescing — menggabungkan pesan text beruntun dari customer menjadi
 * 1 job/balasan (bukan membalas per-pesan).
 *
 * CATATAN: semua test memakai window sangat pendek (ms) & fake timers agar deterministik.
 * Env BURST_COALESCE_MS di-reset tiap test.
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

async function settle(ms = 30) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('BurstCoalesceService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.BURST_COALESCE_MS = '50';
    process.env.BURST_COALESCE_MAX_MESSAGES = '10';
    burstCoalesceService.flushAll();
  });

  afterAll(async () => {
    burstCoalesceService.flushAll();
    await queueService.close();
  });

  it('1. off (BURST_COALESCE_MS=0) → semua pesan passthrough (handled=false)', async () => {
    process.env.BURST_COALESCE_MS = '0';
    const r1 = await burstCoalesceService.maybeCoalesce({
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      phone: '628123456789',
      conversation: makeConv(ConversationState.INITIAL),
      incomingMessage: makeMsg('m1', 'halo bunda'),
    });
    const r2 = await burstCoalesceService.maybeCoalesce({
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      phone: '628123456789',
      conversation: makeConv(ConversationState.INITIAL),
      incomingMessage: makeMsg('m2', 'pijat bayi berapa?'),
    });
    expect(r1.handled).toBe(false);
    expect(r2.handled).toBe(false);
    expect(burstCoalesceService.pendingCount()).toBe(0);
  });

  it('2. 3 text beruntun dalam window → 1 job dengan body gabungan (\\n)', async () => {
    const enqueueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);
    const logSpy = vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

    const opts = {
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      phone: '628123456789',
      conversation: makeConv(ConversationState.INITIAL),
    };

    const r1 = await burstCoalesceService.maybeCoalesce({ ...opts, incomingMessage: makeMsg('m1', 'halo bunda') });
    const r2 = await burstCoalesceService.maybeCoalesce({ ...opts, incomingMessage: makeMsg('m2', 'mau nanya dong') });
    const r3 = await burstCoalesceService.maybeCoalesce({ ...opts, incomingMessage: makeMsg('m3', 'pijat bayi itu buat apa ya?') });

    expect(r1.handled).toBe(true);
    expect(r2.handled).toBe(true);
    expect(r3.handled).toBe(true);
    expect(burstCoalesceService.pendingCount()).toBe(1);

    // Tiap pesan asli langsung di-log (audit trail + live chat realtime).
    expect(logSpy).toHaveBeenCalledTimes(3);

    await settle(80);

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const payload = enqueueSpy.mock.calls[0][0];
    expect(payload.incomingMessage._preLogged).toBe(true);
    expect(payload.incomingMessage._mergedCount).toBe(3);
    expect(payload.incomingMessage.text.body).toBe('halo bunda\nmau nanya dong\npijat bayi itu buat apa ya?');
    expect(payload.incomingMessage.id).toBe('m3');
  });

  it('3. text → location beruntun → flush text dulu, location passthrough (2 job)', async () => {
    const enqueueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);
    vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

    const opts = {
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      phone: '628123456789',
      conversation: makeConv(ConversationState.INITIAL),
    };

    const r1 = await burstCoalesceService.maybeCoalesce({ ...opts, incomingMessage: makeMsg('m1', 'saya di sini nih') });
    expect(r1.handled).toBe(true);

    const locMsg = {
      id: 'm2',
      from: '628123456789',
      chatId: '628123456789@c.us',
      timestamp: '1700000000',
      type: 'location',
      location: { latitude: -7.34, longitude: 112.75 },
    };
    const r2 = await burstCoalesceService.maybeCoalesce({ ...opts, incomingMessage: locMsg });
    expect(r2.handled).toBe(false); // location tidak pernah di-buffer

    await settle(20);

    // Job pertama = merge text "saya di sini nih", job kedua = lokasi (dari caller).
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0][0].incomingMessage._mergedCount).toBe(1);
    expect(burstCoalesceService.pendingCount()).toBe(0);
  });

  it('4. text di state AWAITING_LOCATION → TIDAK di-merge (handled=false)', async () => {
    vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);
    const logSpy = vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

    const r = await burstCoalesceService.maybeCoalesce({
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      phone: '628123456789',
      conversation: makeConv(ConversationState.AWAITING_LOCATION),
      incomingMessage: makeMsg('m1', 'di jambangan bund'),
    });

    expect(r.handled).toBe(false);
    // Tidak ada log dari service (caller/machine yang log) & tidak ada buffer.
    expect(logSpy).not.toHaveBeenCalled();
    expect(burstCoalesceService.pendingCount()).toBe(0);
  });

  it('5. pesan baru setelah window lewat → batch terpisah (2 job)', async () => {
    const enqueueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);
    vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

    const opts = {
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      phone: '628123456789',
      conversation: makeConv(ConversationState.INITIAL),
    };

    await burstCoalesceService.maybeCoalesce({ ...opts, incomingMessage: makeMsg('m1', 'halo') });
    await settle(80); // window pertama habis → flush batch 1

    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    await burstCoalesceService.maybeCoalesce({ ...opts, incomingMessage: makeMsg('m2', 'masih ada?') });
    await settle(80); // window kedua habis → flush batch 2

    expect(enqueueSpy).toHaveBeenCalledTimes(2);
    expect(enqueueSpy.mock.calls[0][0].incomingMessage.text.body).toBe('halo');
    expect(enqueueSpy.mock.calls[1][0].incomingMessage.text.body).toBe('masih ada?');
  });

  it('6. max messages tercapai → flush dulu, batch baru mulai', async () => {
    process.env.BURST_COALESCE_MAX_MESSAGES = '2';
    const enqueueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);
    vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

    const opts = {
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      phone: '628123456789',
      conversation: makeConv(ConversationState.INITIAL),
    };

    await burstCoalesceService.maybeCoalesce({ ...opts, incomingMessage: makeMsg('m1', 'a') });
    await burstCoalesceService.maybeCoalesce({ ...opts, incomingMessage: makeMsg('m2', 'b') });
    // Pesan ke-3: buffer penuh (2) → flush batch 1, lalu m3 mulai batch baru.
    await burstCoalesceService.maybeCoalesce({ ...opts, incomingMessage: makeMsg('m3', 'c') });

    await settle(20);
    expect(enqueueSpy).toHaveBeenCalledTimes(1); // flush batch m1+m2
    expect(enqueueSpy.mock.calls[0][0].incomingMessage.text.body).toBe('a\nb');

    await settle(80);
    expect(enqueueSpy).toHaveBeenCalledTimes(2); // batch m3
    expect(enqueueSpy.mock.calls[1][0].incomingMessage.text.body).toBe('c');
  });

  it('7. command slash (/reset) → flush buffer lalu passthrough (handled=false)', async () => {
    const enqueueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);
    vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

    const opts = {
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      phone: '628123456789',
      conversation: makeConv(ConversationState.INITIAL),
    };

    // 1 text biasa → masuk buffer
    const r1 = await burstCoalesceService.maybeCoalesce({ ...opts, incomingMessage: makeMsg('m1', 'halo bunda') });
    expect(r1.handled).toBe(true);
    expect(burstCoalesceService.pendingCount()).toBe(1);

    // Command slash berikutnya → flush buffer (batch pertama ter-enqueue), passthrough.
    const r2 = await burstCoalesceService.maybeCoalesce({ ...opts, incomingMessage: makeMsg('m2', '/reset') });
    expect(r2.handled).toBe(false); // tidak di-merge, langsung ke machine command gate
    expect(burstCoalesceService.pendingCount()).toBe(0);

    await settle(20);
    expect(enqueueSpy).toHaveBeenCalledTimes(1); // batch "halo bunda" ter-flush
    expect(enqueueSpy.mock.calls[0][0].incomingMessage.text.body).toBe('halo bunda');
  });
});
