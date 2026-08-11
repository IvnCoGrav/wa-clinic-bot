import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { buildApp } from '../../src/app';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { queueService } from '../../src/services/queue.service';
import { wahaClient } from '../../src/integrations/waha/client';
import { FastifyInstance } from 'fastify';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Stage 3: Label & AI Router Interaction (10 Test Cases)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    process.env.ADMIN_API_KEY = 'test_admin_key_123';
    process.env.ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER = 'false';
    await seedAiScopeAll();
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  function messagePayload(waMessageId: string, phone: string, body = 'halo') {
    return {
      event: 'message',
      session: 'default',
      payload: {
        id: waMessageId,
        from: `${phone}@c.us`,
        fromMe: false,
        timestamp: Math.floor(Date.now() / 1000),
        body,
      },
    };
  }

  it('[TC 21] is_hold_labeled=true & HumanHandling → AI Router mengabaikan pesan (HUMAN_HANDLING_ACTIVE_SILENT)', async () => {
    const phone = `6287771${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Hold Customer', DEFAULT_TENANT_ID);
    await customerService.setLabelFlags(phone, { isHoldLabeled: true });
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(conv.id, { isHumanHandling: true, humanHandlingSince: new Date() }, DEFAULT_TENANT_ID);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: messagePayload(`msg_tc21_${Date.now()}`, phone),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'HUMAN_HANDLING_ACTIVE_SILENT' });
  });

  it('[TC 22] is_admin_labeled=true → AI Router mem-bypass pesan (IGNORED_ADMIN)', async () => {
    const phone = `6287772${Date.now()}`;
    await customerService.getOrCreateCustomer(phone, 'Admin Customer', DEFAULT_TENANT_ID);
    await customerService.setLabelFlags(phone, { isAdminLabeled: true });

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: messagePayload(`msg_tc22_${Date.now()}`, phone),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'IGNORED_ADMIN' });
  });

  it('[TC 23] Customer dengan label biasa → Pesan tetap diproses', async () => {
    const phone = `6287773${Date.now()}`;
    await customerService.getOrCreateCustomer(phone, 'Normal Customer', DEFAULT_TENANT_ID);
    await customerService.setLabelFlags(phone, { isHoldLabeled: false, isAdminLabeled: false });

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: messagePayload(`msg_tc23_${Date.now()}`, phone),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).not.toBe('IGNORED_ADMIN');
  });

  it('[TC 24] Manual Eskalasi → Memanggil addLabel("hold") dan set is_hold_labeled=true', async () => {
    const phone = `6287774${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Escalate Customer', DEFAULT_TENANT_ID);
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const spy = vi.spyOn(wahaClient, 'addLabel');
    await conversationService.escalateToHumanHandling(conv, phone, 'manual escalate test', DEFAULT_TENANT_ID);

    expect(spy).toHaveBeenCalledWith(`${phone}@c.us`, 'hold');
    const updated = await customerService.getCustomerById(customer.id, DEFAULT_TENANT_ID);
    expect(updated.is_hold_labeled).toBe(true);
    spy.mockRestore();
  });

  it('[TC 25] Release state → Memanggil removeLabel("hold") dan reset is_hold_labeled=false', async () => {
    const phone = `6287775${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Release Customer', DEFAULT_TENANT_ID);
    await customerService.setLabelFlags(phone, { isHoldLabeled: true });
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(conv.id, { isHumanHandling: true, humanHandlingSince: new Date() }, DEFAULT_TENANT_ID);

    const spy = vi.spyOn(wahaClient, 'removeLabel');
    await wahaClient.removeLabel(`${phone}@c.us`, 'hold');
    await customerService.setLabelFlags(phone, { isHoldLabeled: false });
    await conversationService.updateConversationState(conv.id, { isHumanHandling: false, humanHandlingSince: null }, DEFAULT_TENANT_ID);

    expect(spy).toHaveBeenCalledWith(`${phone}@c.us`, 'hold');
    const updated = await customerService.getCustomerById(customer.id, DEFAULT_TENANT_ID);
    expect(updated.is_hold_labeled).toBe(false);
    spy.mockRestore();
  });

  it('[TC 26] Perubahan label mendadak di DB → Router langsung mendeteksi tanpa server restart', async () => {
    const phone = `6287776${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Dynamic Change Customer', DEFAULT_TENANT_ID);
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    // Dynamic set true
    await customerService.setLabelFlags(phone, { isHoldLabeled: true });
    await conversationService.updateConversationState(conv.id, { isHumanHandling: true, humanHandlingSince: new Date() }, DEFAULT_TENANT_ID);
    let res = await app.inject({ method: 'POST', url: '/webhook', payload: messagePayload(`msg_tc26_1_${Date.now()}`, phone) });
    expect(JSON.parse(res.body)).toEqual({ status: 'HUMAN_HANDLING_ACTIVE_SILENT' });

    // Dynamic set false
    await customerService.setLabelFlags(phone, { isHoldLabeled: false });
    await conversationService.updateConversationState(conv.id, { isHumanHandling: false, humanHandlingSince: null }, DEFAULT_TENANT_ID);
    res = await app.inject({ method: 'POST', url: '/webhook', payload: messagePayload(`msg_tc26_2_${Date.now()}`, phone) });
    expect(JSON.parse(res.body).status).not.toBe('HUMAN_HANDLING_ACTIVE_SILENT');
  });

  it('[TC 27] AI Router tidak memanggil WAHA API `getChatLabels` saat DB record customer valid', async () => {
    const phone = `6287777${Date.now()}`;
    await customerService.getOrCreateCustomer(phone, 'Fast Path Customer', DEFAULT_TENANT_ID);

    const getLabelsSpy = vi.spyOn(wahaClient, 'getChatLabels');
    await app.inject({ method: 'POST', url: '/webhook', payload: messagePayload(`msg_tc27_${Date.now()}`, phone) });
    expect(getLabelsSpy).not.toHaveBeenCalled();
    getLabelsSpy.mockRestore();
  });

  it('[TC 28] Eskalasi berulang → tidak memanggil addLabel ("hold") berulang kali jika sudah hold', async () => {
    const phone = `6287778${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Repeat Escalate Customer', DEFAULT_TENANT_ID);
    await customerService.setLabelFlags(phone, { isHoldLabeled: true });
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const spy = vi.spyOn(wahaClient, 'addLabel');
    await conversationService.escalateToHumanHandling(conv, phone, 'second escalate', DEFAULT_TENANT_ID);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('[TC 29] Multi-tenant label check → setLabelFlags untuk phone tertentu meng-update secara global', async () => {
    const phone = `6287779${Date.now()}`;
    await customerService.getOrCreateCustomer(phone, 'Tenant A Cust', 'tenant-a');
    await customerService.setLabelFlags(phone, { isHoldLabeled: true });

    const custB = await customerService.getOrCreateCustomer(phone, 'Tenant B Cust', 'tenant-b');
    expect(custB.is_hold_labeled).toBe(true);
  });

  it('[TC 30] Flag is_admin_labeled dan is_hold_labeled bersamaan → IGNORED_ADMIN mendapat prioritas', async () => {
    const phone = `6287780${Date.now()}`;
    await customerService.getOrCreateCustomer(phone, 'Both Labels Customer', DEFAULT_TENANT_ID);
    await customerService.setLabelFlags(phone, { isAdminLabeled: true, isHoldLabeled: true });

    const res = await app.inject({ method: 'POST', url: '/webhook', payload: messagePayload(`msg_tc30_${Date.now()}`, phone) });
    expect(JSON.parse(res.body)).toEqual({ status: 'IGNORED_ADMIN' });
  });
});
