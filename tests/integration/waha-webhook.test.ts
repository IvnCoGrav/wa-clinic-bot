import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { queueService } from '../../src/services/queue.service';
import { wahaClient } from '../../src/integrations/waha/client';
import { FastifyInstance } from 'fastify';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('WAHA Webhook & Guard Clause Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    await seedAiScopeAll();
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  it('POST /webhook: process WAHA event message and apply idempotency', async () => {
    const waMessageId = `waha_test_msg_${Date.now()}`;
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: waMessageId,
        from: '628999888777@c.us',
        fromMe: false,
        timestamp: 1700000000,
        body: 'Halo admin',
        _data: { notifyName: 'Customer WAHA' },
      },
    };

    // First Payload Request
    const res1 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });

    expect(res1.statusCode).toBe(200);
    expect(JSON.parse(res1.body)).toEqual({ status: 'EVENT_PROCESSED' });

    // Second Duplicate Request with SAME waMessageId
    const res2 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });

    expect(res2.statusCode).toBe(200);
    expect(JSON.parse(res2.body)).toEqual({ status: 'IGNORED_DUPLICATE' });
  });

  it('POST /webhook: Explicit Guard Clause prevents LLM/bot replies when is_human_handling is active', async () => {
    const phone = `628777${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Human Test Customer', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    // Update conversation state in conversationService memory map
    await conversationService.updateConversationState(
      conversation.id,
      {
        isHumanHandling: true,
        humanHandlingSince: new Date(),
      },
      DEFAULT_TENANT_ID
    );

    // Pasang label hold di mock WAHA agar terdeteksi masih dalam hold
    await wahaClient.addLabel(`${phone}@c.us`, 'hold');

    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: `waha_human_msg_${Date.now()}`,
        from: `${phone}@c.us`,
        fromMe: false,
        timestamp: 1700000000,
        body: 'Halo apakah ada manusia?',
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'HUMAN_HANDLING_ACTIVE_SILENT' });
  });

  it('POST /webhook: should verify X-Webhook-Secret signature security token', async () => {
    // Set secret token
    process.env.WAHA_WEBHOOK_SECRET = 'my_secret_token_abc';

    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: `waha_secret_msg_${Date.now()}`,
        from: '628999111222@c.us',
        fromMe: false,
        timestamp: 1700000000,
        body: 'test webhook secret',
      },
    };

    // 1. Tanpa header -> 401
    const resNoHeader = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });
    expect(resNoHeader.statusCode).toBe(401);

    // 2. Header salah -> 401
    const resWrongHeader = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'x-webhook-secret': 'wrong_token',
      },
      payload,
    });
    expect(resWrongHeader.statusCode).toBe(401);

    // 3. Header benar -> 200
    const resValidHeader = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'x-webhook-secret': 'my_secret_token_abc',
      },
      payload,
    });
    expect(resValidHeader.statusCode).toBe(200);

    // Cleanup env
    delete process.env.WAHA_WEBHOOK_SECRET;
  });

  it('POST /webhook: should bypass messages from numbers labeled as Admin', async () => {
    const adminPhone = `628111222333`;
    const chatId = `${adminPhone}@c.us`;

    // Pasang label Admin di mock WAHA
    await wahaClient.addLabel(chatId, 'Admin');

    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: `waha_admin_msg_${Date.now()}`,
        from: chatId,
        fromMe: false,
        timestamp: 1700000000,
        body: 'Halo ini pegawai/admin',
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'IGNORED_ADMIN' });

    // Hapus label Admin setelah pengujian
    await wahaClient.removeLabel(chatId, 'Admin');
  });

  it('POST /webhook: fromMe admin reply resets human handling auto-release timer', async () => {
    const phone = `628999${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Human Test Customer', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    // Aktifkan human handling dengan timer 5 jam yang lalu (mendekati batas auto-release 6 jam)
    await conversationService.updateConversationState(
      conversation.id,
      {
        isHumanHandling: true,
        humanHandlingSince: new Date(Date.now() - 1000 * 60 * 60 * 5),
        escalationReason: 'complex_query',
      },
      DEFAULT_TENANT_ID
    );

    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: `waha_fromme_msg_${Date.now()}`,
        chatId: `${phone}@c.us`,
        fromMe: true,
        timestamp: 1700000000,
        body: 'Baik Bunda, nanti kami konfirmasi ya',
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'IGNORED_OUTBOUND' });

    // Beri kesempatan fire-and-forget reset (DB offline -> memory store) selesai
    await new Promise((r) => setTimeout(r, 0));

    const refreshed = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(refreshed.is_human_handling).toBe(true);
    expect(refreshed.human_handling_since).toBeTruthy();
    const since = new Date(refreshed.human_handling_since).getTime();
    expect(since).toBeGreaterThan(Date.now() - 5000);
  });
});
