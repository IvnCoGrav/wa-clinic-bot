import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { burstCoalesceService } from '../../src/services/burst-coalesce.service';
import { queueService } from '../../src/services/queue.service';
import { messageService } from '../../src/services/message.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * F8 / M02-12 — STOP/UNSUBSCRIBE adalah pesan berprioritas:
 * - tidak boleh digabung ke dalam burst (kalau digabung, exact-match opt-out hilang);
 * - buffer yang sudah ada harus di-flush lebih dulu, lalu STOP diproses utuh.
 * Konfirmasi /reset yang sedang pending juga tidak boleh di-merge (M01-14).
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

const conv = (overrides: any = {}) => ({
  id: `conv-f8-${Math.random().toString(36).slice(2)}`,
  current_state: ConversationState.INITIAL,
  session_data: null,
  ...overrides,
});

const opts = (conversation: any, incomingMessage: any) => ({
  tenantId: DEFAULT_TENANT_ID,
  customerId: 'cust-f8-stop',
  phone: '628123456789',
  conversation,
  incomingMessage,
});

describe('F8 — prioritas STOP & reset pending pada burst coalescer', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env.BURST_COALESCE_MS = '50';
    process.env.BURST_COALESCE_MAX_MESSAGES = '10';
    await burstCoalesceService.flushAll();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.BURST_COALESCE_MS;
    await burstCoalesceService.flushAll();
  });

  it.each(['STOP', 'stop', 'UNSUBSCRIBE', 'STOP PROMO'])(
    '"%s" sendirian → tidak pernah dibuffer (handled=false)',
    async (text) => {
      const res = await burstCoalesceService.maybeCoalesce(opts(conv(), makeMsg('m-stop', text)));
      expect(res.handled).toBe(false);
      expect(burstCoalesceService.pendingCount()).toBe(0);
    }
  );

  it('buffer teks biasa di-flush lebih dulu; STOP diproses utuh terpisah', async () => {
    const enqueueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);
    vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

    const conversation = conv();
    const first = await burstCoalesceService.maybeCoalesce(
      opts(conversation, makeMsg('m1', 'halo bunda'))
    );
    expect(first.handled).toBe(true);

    const stop = await burstCoalesceService.maybeCoalesce(opts(conversation, makeMsg('m2', 'STOP')));
    expect(stop.handled).toBe(false);
    expect(burstCoalesceService.pendingCount()).toBe(0);

    // Hanya buffer lama ("halo bunda") yang di-enqueue — STOP TIDAK digabung.
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const payload: any = enqueueSpy.mock.calls[0][0];
    expect(payload.incomingMessage.text.body).toBe('halo bunda');
    expect(payload.incomingMessage.text.body).not.toContain('STOP');
  });

  it('saat menunggu konfirmasi /reset, pesan biasa tidak ditunda ke buffer', async () => {
    const conversation = conv({ session_data: { reset_pending_at: new Date().toISOString() } });

    const res = await burstCoalesceService.maybeCoalesce(
      opts(conversation, makeMsg('m3', 'iya bener'))
    );

    expect(res.handled).toBe(false);
    expect(burstCoalesceService.pendingCount()).toBe(0);
  });

  it('reset pending kedaluwarsa tidak lagi memblokir coalescing normal', async () => {
    vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);
    vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);
    const conversation = conv({
      session_data: { reset_pending_at: new Date(Date.now() - 6 * 60 * 1000).toISOString() },
    });

    const res = await burstCoalesceService.maybeCoalesce(
      opts(conversation, makeMsg('m4', 'halo lagi'))
    );

    expect(res.handled).toBe(true);
    await burstCoalesceService.flushAll();
  });
});
