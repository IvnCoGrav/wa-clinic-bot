import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { messageService } from '../../src/services/message.service';
import { getLiveChatHub } from '../../src/services/live-chat-hub.service';
import { FastifyInstance } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const ADMIN_KEY = 'test_admin_key_read_ghost';

/**
 * Regresi AUDIT LIVE CHAT #316 / T-01 (ghost read).
 * Saat DB offline, service memakai memory fallback. Dulu route tetap menyiarkan
 * `unreadCount: 0` ke semua dashboard → badge padam, lalu unread muncul lagi
 * setelah reload. Kontrak baru: status "degraded" + TIDAK ada siaran palsu.
 */
describe('Live Chat mark-read — anti ghost read saat DB offline', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const setupConversation = async (name: string) => {
    const phone = `628810${Date.now().toString().slice(-7)}`;
    const customer = await customerService.getOrCreateCustomer(phone, name, DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: 'INBOUND',
      content: 'Halo, saya ingin bertanya jadwal.',
      senderType: 'CUSTOMER',
    });
    return conversation;
  };

  const captureEvents = async (fn: () => Promise<any>) => {
    const events: any[] = [];
    const unsubscribe = await getLiveChatHub().subscribe(DEFAULT_TENANT_ID, (e) => events.push(e));
    try {
      const result = await fn();
      // Beri ruang microtask untuk publish fire-and-forget.
      await new Promise((r) => setTimeout(r, 10));
      return { result, events };
    } finally {
      unsubscribe();
    }
  };

  it('PATCH /read: degraded + TIDAK menyiarkan unreadCount=0 palsu', async () => {
    const conv = await setupConversation('Bunda Read Ghost');
    const { result, events } = await captureEvents(() =>
      app.inject({
        method: 'PATCH',
        url: `/api/admin/conversations/${conv.id}/read`,
        headers: { 'x-api-key': ADMIN_KEY },
      })
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(body.degraded).toBe(true);
    expect(
      events.some((e) => e?.type === 'conversation.updated' && e?.payload?.unreadCount === 0)
    ).toBe(false);

    // Memory fallback tetap menandai terbaca agar UI lokal konsisten.
    const unread = await messageService.getUnreadCountsBatch([conv.id], DEFAULT_TENANT_ID);
    expect(unread.get(conv.id) || 0).toBe(0);
  });

  it('PATCH /unread: degraded + TIDAK menyiarkan status palsu', async () => {
    const conv = await setupConversation('Bunda Unread Ghost');
    const { result, events } = await captureEvents(() =>
      app.inject({
        method: 'PATCH',
        url: `/api/admin/conversations/${conv.id}/unread`,
        headers: { 'x-api-key': ADMIN_KEY },
      })
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.degraded).toBe(true);
    expect(events.some((e) => e?.type === 'conversation.updated')).toBe(false);
  });

  it('POST /mark-all-read: degraded + TIDAK menyiarkan allRead', async () => {
    const { result, events } = await captureEvents(() =>
      app.inject({
        method: 'POST',
        url: '/api/admin/live-chat/mark-all-read',
        headers: { 'x-api-key': ADMIN_KEY },
      })
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.degraded).toBe(true);
    expect(events.some((e) => e?.type === 'conversation.updated' && e?.payload?.allRead)).toBe(false);
  });
});
