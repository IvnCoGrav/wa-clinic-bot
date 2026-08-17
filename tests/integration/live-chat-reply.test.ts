import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { messageService } from '../../src/services/message.service';
import { createTestGateway, resetGateway } from '../../src/integrations/whatsapp/factory';
import { FastifyInstance } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

// Mock WAHA client: sync-history endpoint tidak boleh HTTP ke WAHA asli saat test offline.
const wahaMocks = vi.hoisted(() => ({
  getChats: vi.fn(),
  getMessages: vi.fn(),
  getPhoneNumberFromLid: vi.fn(),
}));
vi.mock('../../src/integrations/waha/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/integrations/waha/client')>();
  Object.assign(actual.wahaClient, {
    getChats: wahaMocks.getChats,
    getMessages: wahaMocks.getMessages,
    getPhoneNumberFromLid: wahaMocks.getPhoneNumberFromLid,
  });
  return actual;
});
const { getChats: mockGetChats, getMessages: mockGetMessages, getPhoneNumberFromLid: mockPhoneFromLid } = wahaMocks;

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
    mockGetChats.mockReset();
    mockGetMessages.mockReset();
    mockPhoneFromLid.mockReset();
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

  it('GET /api/admin/live-chat/conversations?mode=real|sandbox memisahkan chat test dari WhatsApp asli', async () => {
    const phoneReal = `628700${Date.now()}`;
    const phoneSand = `628800${Date.now()}`;
    const customerReal = await customerService.getOrCreateCustomer(phoneReal, 'Bunda Mode Real', DEFAULT_TENANT_ID);
    const convReal = await conversationService.getOrCreateConversation(customerReal.id, DEFAULT_TENANT_ID);
    const customerSand = await customerService.getOrCreateCustomer(phoneSand, 'Bunda Mode Sandbox', DEFAULT_TENANT_ID);
    customerSand.is_sandbox_test = true; // memory store fallback (DB offline di test)
    const convSand = await conversationService.getOrCreateConversation(customerSand.id, DEFAULT_TENANT_ID);

    const allRes = await app.inject({
      method: 'GET',
      url: '/api/admin/live-chat/conversations',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    const allBody = JSON.parse(allRes.body);
    expect(allBody.data.some((c: any) => c.conversationId === convReal.id)).toBe(true);
    expect(allBody.data.some((c: any) => c.conversationId === convSand.id)).toBe(true);

    const realRes = await app.inject({
      method: 'GET',
      url: '/api/admin/live-chat/conversations?mode=real',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    const realBody = JSON.parse(realRes.body);
    expect(realBody.mode).toBe('real');
    expect(realBody.data.some((c: any) => c.conversationId === convReal.id)).toBe(true);
    expect(realBody.data.some((c: any) => c.conversationId === convSand.id)).toBe(false);

    const sandRes = await app.inject({
      method: 'GET',
      url: '/api/admin/live-chat/conversations?mode=sandbox',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    const sandBody = JSON.parse(sandRes.body);
    expect(sandBody.mode).toBe('sandbox');
    expect(sandBody.data.some((c: any) => c.conversationId === convSand.id)).toBe(true);
    expect(sandBody.data.some((c: any) => c.conversationId === convReal.id)).toBe(false);
  });

  it('POST reply ke chat sandbox/test → 403 SANDBOX_REPLY_BLOCKED, gateway tidak dipanggil', async () => {
    const fake = {
      providerType: 'WAHA',
      sendTextMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'waid_should_not_send', provider: 'WAHA' }),
    } as any;
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const customer = await customerService.getOrCreateCustomer(`628900${Date.now()}`, 'Bunda Sandbox Block', DEFAULT_TENANT_ID);
    customer.is_sandbox_test = true;
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/live-chat/conversations/${conversation.id}/reply`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { text: 'Halo test', adminName: 'Admin Klinik' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('SANDBOX_REPLY_BLOCKED');
    expect(fake.sendTextMessage).not.toHaveBeenCalled();
  });

  it('POST /api/admin/live-chat/sync-history backfill chat WAHA (batch + load more)', async () => {
    mockGetChats.mockResolvedValue([
      { id: '62877700001@c.us', name: 'Bunda Sync 1' },
      { id: '628999999999@c.us', name: 'Bunda Dummy' }, // sandbox → skip
    ]);
    mockGetMessages.mockResolvedValue([
      { id: 'sync_m1', body: 'Halo dari history', fromMe: false, timestamp: 1700000000 },
    ]);
    mockPhoneFromLid.mockResolvedValue('62877700001');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/live-chat/sync-history',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { limit: 50, offset: 0 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.syncedChats).toBe(1); // sandbox di-skip
    expect(body.data.skippedChats).toBe(1);
    expect(body.data.syncedMessages).toBe(1);
    expect(body.data.totalChats).toBe(2);
    expect(body.data.hasMore).toBe(false);

    // Pesan history tersimpan & terlihat di daftar conversation (mode real)
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/admin/live-chat/conversations?mode=real',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    const listBody = JSON.parse(listRes.body);
    expect(listBody.data.some((c: any) => c.customerPhone === '62877700001')).toBe(true);
  });

  it('POST /api/admin/live-chat/sync-history WAHA error → 500 tanpa crash', async () => {
    mockGetChats.mockRejectedValue(new Error('WAHA unreachable'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/live-chat/sync-history',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { limit: 50, offset: 0 },
    });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).success).toBe(false);
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

  it('POST /api/admin/live-chat/conversations/:id/suggest-reply menghasilkan draf saran AI', async () => {
    const phone = `628900${Date.now()}`;
    const cust = await customerService.getOrCreateCustomer(phone, 'Bunda AI Test', DEFAULT_TENANT_ID);
    const conv = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/live-chat/conversations/${conv.id}/suggest-reply`,
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(typeof body.data.draftText).toBe('string');
    expect(body.data.draftText.length).toBeGreaterThan(0);
  });

  it('GET /api/admin/customers/:id mengembalikan detail customer & metrik', async () => {
    const phone = `628901${Date.now()}`;
    const cust = await customerService.getOrCreateCustomer(phone, 'Bunda Detail Test', DEFAULT_TENANT_ID);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/customers/${cust.id}`,
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(cust.id);
    expect(typeof body.data.ltv).toBe('number');
    expect(typeof body.data.purchaseCount).toBe('number');
  });
});

