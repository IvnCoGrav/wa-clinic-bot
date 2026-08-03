import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { messageService } from '../../src/services/message.service';
import { createTestGateway, resetGateway } from '../../src/integrations/whatsapp/factory';
import { FastifyInstance } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const ADMIN_KEY = 'test_admin_key_livechat';

describe('Live Chat Admin Endpoints (monitor & balas)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = buildApp();
    await app.ready();
  });

  beforeEach(() => {
    resetGateway();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/admin/live-chat/conversations/:id/reply mengirim balasan + auto-escalation', async () => {
    const fake = {
      providerType: 'WAHA',
      sendTextMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'waid_reply_1', provider: 'WAHA' }),
    } as any;
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const phone = `628500${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Endpoint', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/live-chat/conversations/${conversation.id}/reply`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { text: 'Baik Bunda, dokter akan segera merespon', adminName: 'Admin Klinik' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.conversation.isHumanHandling).toBe(true);
    expect(fake.sendTextMessage).toHaveBeenCalledWith(phone, 'Baik Bunda, dokter akan segera merespon');
  });

  it('GET /api/admin/live-chat/conversations & :id/messages menampilkan thread dengan sender ADMIN', async () => {
    const phone = `628600${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Thread', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: 'INBOUND',
      content: 'Halo dok',
    });
    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      content: 'Halo Bunda',
      senderType: 'ADMIN',
      senderName: 'Admin',
    });

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/admin/live-chat/conversations',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    const item = listBody.data.find((c: any) => c.conversationId === conversation.id);
    expect(item).toBeTruthy();
    expect(item.customerPhone).toBe(phone);
    expect(item.lastMessages.some((m: any) => m.sender_type === 'ADMIN')).toBe(true);

    const msgRes = await app.inject({
      method: 'GET',
      url: `/api/admin/live-chat/conversations/${conversation.id}/messages`,
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(msgRes.statusCode).toBe(200);
    const msgBody = JSON.parse(msgRes.body);
    expect(msgBody.data.length).toBe(2);
    expect(msgBody.data[1].sender_type).toBe('ADMIN');
  });

  it('POST reply dengan text kosong → 400 EMPTY_REPLY', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/live-chat/conversations/conv_any/reply',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { text: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('EMPTY_REPLY');
  });

  it('POST reply untuk conversation tak dikenal → 404 CONVERSATION_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/live-chat/conversations/conv_unknown_xyz/reply',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { text: 'Halo' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('CONVERSATION_NOT_FOUND');
  });
});
