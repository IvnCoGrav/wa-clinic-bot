import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { buildApp } from '../../src/app';
import { messageService } from '../../src/services/message.service';
import { wabaTenantService } from '../../src/services/waba-tenant.service';
import { inboundEventDedup } from '../../src/services/inbound-event-dedup.service';
import { prisma } from '../../src/db/client';

/**
 * F8 / M02-11 — reaction dimutasi SEBELUM jalur idempotensi pesan. WAHA & Meta
 * dapat mengirim ulang event yang sama; mutasi + broadcast SSE tidak boleh ganda.
 */

const APP_SECRET = 'f8_reaction_secret';

function wahaReaction(emoji = '👍', id = 'reaction-evt-1') {
  return {
    event: 'message.reaction',
    session: 'default',
    payload: {
      id,
      from: '628111222333@c.us',
      chatId: '628111222333@c.us',
      timestamp: 1700000000,
      reaction: { text: emoji, messageId: 'wamid.target' },
    },
  };
}

function wabaBody(emoji = '👍', messageId = 'wamid.reaction.1') {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'e1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '6281234', phone_number_id: 'PNID_REACT' },
              contacts: [{ profile: { name: 'Bunda Uji' }, wa_id: '628111222333' }],
              messages: [
                {
                  id: messageId,
                  from: '628111222333',
                  timestamp: '1700000000',
                  type: 'reaction',
                  reaction: { message_id: 'wamid.target', emoji },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function sign(body: string): string {
  return `sha256=${crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
}

describe('F8 — dedup reaction sebelum mutasi', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    inboundEventDedup.reset();
    wabaTenantService.resetCache();
    process.env.WAHA_ALLOW_UNSIGNED_WEBHOOK = 'true';
    process.env.WABA_APP_SECRET = APP_SECRET;
    // `restoreAllMocks` mengosongkan implementasi mock global; pasang tenant DB
    // deterministik agar resolusi session/phone_number_id tidak fail-closed.
    (prisma.tenant as any).findFirst = vi.fn().mockResolvedValue({ id: 'default-tenant' });
    (prisma.tenant as any).findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'default-tenant', name: 'Klinik Uji', waba_access_token: null });
  });

  it('event reaction WAHA yang sama dua kali → mutasi hanya sekali', async () => {
    const spy = vi.spyOn(messageService, 'addOrUpdateReaction').mockResolvedValue({ success: true } as any);

    const first = await app.inject({ method: 'POST', url: '/webhook', payload: wahaReaction() });
    const second = await app.inject({ method: 'POST', url: '/webhook', payload: wahaReaction() });

    expect(first.json().status).toBe('REACTION_PROCESSED');
    expect(second.json().status).toBe('REACTION_DUPLICATE');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emoji berbeda adalah event baru → tetap diproses', async () => {
    const spy = vi.spyOn(messageService, 'addOrUpdateReaction').mockResolvedValue({ success: true } as any);

    await app.inject({ method: 'POST', url: '/webhook', payload: wahaReaction('👍', 'evt-a') });
    const second = await app.inject({ method: 'POST', url: '/webhook', payload: wahaReaction('❤️', 'evt-b') });

    expect(second.json().status).toBe('REACTION_PROCESSED');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][2]).toEqual(expect.objectContaining({ emoji: '❤️' }));
  });

  it('reaction WABA duplikat (message id sama) → mutasi hanya sekali', async () => {
    const spy = vi.spyOn(messageService, 'addOrUpdateReaction').mockResolvedValue({ success: true } as any);

    const body = wabaBody();
    const first = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });

    expect(first.statusCode).toBe(200);
    expect(second.json().status).toBe('REACTION_DUPLICATE');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('dedup service: klaim kedua ditolak, pulih setelah TTL', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-27T00:00:00Z'));
      expect(await inboundEventDedup.claimOnce('k1', 60_000)).toBe(true);
      expect(await inboundEventDedup.claimOnce('k1', 60_000)).toBe(false);

      vi.advanceTimersByTime(61_000);
      expect(await inboundEventDedup.claimOnce('k1', 60_000)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
