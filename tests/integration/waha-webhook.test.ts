import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { queueService } from '../../src/services/queue.service';
import { FastifyInstance } from 'fastify';

describe('WAHA Webhook & Guard Clause Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
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
    const customer = await customerService.getOrCreateCustomer(phone, 'Human Test Customer');
    const conversation = await conversationService.getOrCreateConversation(customer.id);

    // Update conversation state in conversationService memory map
    await conversationService.updateConversationState(conversation.id, {
      isHumanHandling: true,
      humanHandlingSince: new Date(),
    });

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
});
