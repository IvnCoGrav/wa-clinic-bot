import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { FastifyInstance } from 'fastify';

describe('Live Chat Manual Takeover & Release Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. PATCH /api/admin/conversation/:id/takeover successfully takes over conversation from bot', async () => {
    const phone = `62855${Math.floor(1000000 + Math.random() * 9000000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, 'Ibu Maya', DEFAULT_TENANT_ID);
    const conv = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);

    // Initial state: bot handling
    expect(conv.is_human_handling).toBe(false);

    // Admin takes over
    const resTakeover = await app.inject({
      method: 'PATCH',
      url: `/api/admin/conversation/${conv.id}/takeover`,
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(resTakeover.statusCode).toBe(200);
    const bodyTakeover = JSON.parse(resTakeover.body);
    expect(bodyTakeover.success).toBe(true);

    const updatedConv = await conversationService.getConversationById(conv.id, DEFAULT_TENANT_ID);
    expect(updatedConv?.is_human_handling).toBe(true);
    expect(updatedConv?.escalation_reason).toBe('manual_takeover');
  });

  it('2. PATCH /api/admin/conversation/:id/release successfully releases conversation back to bot', async () => {
    const phone = `62855${Math.floor(1000000 + Math.random() * 9000000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, 'Ibu Ratih', DEFAULT_TENANT_ID);
    const conv = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);

    // Set to human handling first
    await conversationService.updateConversationState(
      conv.id,
      { isHumanHandling: true, humanHandlingSince: new Date(), escalationReason: 'manual_takeover' },
      DEFAULT_TENANT_ID
    );

    // Admin releases back to bot
    const resRelease = await app.inject({
      method: 'PATCH',
      url: `/api/admin/conversation/${conv.id}/release`,
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(resRelease.statusCode).toBe(200);
    const bodyRelease = JSON.parse(resRelease.body);
    expect(bodyRelease.success).toBe(true);

    const updatedConv = await conversationService.getConversationById(conv.id, DEFAULT_TENANT_ID);
    expect(updatedConv?.is_human_handling).toBe(false);
  });
});
