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

/**
 * Task: event-driven label sync (label.chat.added / label.chat.deleted).
 * Cover: kolom Customer.is_admin_labeled / is_hold_labeled di-update oleh event,
 * jalur pesan masuk membaca kolom DB (tanpa HTTP call ke WAHA), dan fallback
 * ke getChatLabels tetap jalan untuk chat tanpa record / DB offline.
 */
describe('WAHA Label Events & DB-column Fast Path', () => {
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

  function labelEvent(event: string, chatId: string, labelName: string | null) {
    return {
      event,
      session: 'default',
      payload: {
        labelId: '6',
        chatId,
        label: labelName ? { id: '6', name: labelName, color: 1 } : null,
      },
    };
  }

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

  it('label.chat.added (hold) → kolom is_hold_labeled=true; pesan masuk dibaca dari DB tanpa getChatLabels', async () => {
    const phone = `6283331${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Hold Event', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      {
        isHumanHandling: true,
        humanHandlingSince: new Date(),
        previousState: ConversationState.AWAITING_INTEREST,
      },
      DEFAULT_TENANT_ID
    );

    // Event WAHA: admin memasang label 'hold' manual di aplikasi WA Business
    const resEvent = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: labelEvent('label.chat.added', `${phone}@c.us`, 'hold'),
    });
    expect(resEvent.statusCode).toBe(200);
    expect(JSON.parse(resEvent.body)).toEqual({ status: 'LABEL_EVENT_PROCESSED' });

    const refreshed = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
    expect(refreshed.is_hold_labeled).toBe(true);

    // Pesan masuk berikutnya: bot tetap silent, TANPA memanggil getChatLabels
    const getLabelsSpy = vi.spyOn(wahaClient, 'getChatLabels');
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: messagePayload(`msg_hold_event_${Date.now()}`, phone),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'HUMAN_HANDLING_ACTIVE_SILENT' });
    expect(getLabelsSpy).not.toHaveBeenCalled();
    getLabelsSpy.mockRestore();
  });

  it('label.chat.deleted (hold) → kolom is_hold_labeled=false; pesan berikutnya auto-release tanpa getChatLabels', async () => {
    const phone = `6283332${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Release Event', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      {
        isHumanHandling: true,
        humanHandlingSince: new Date(),
        previousState: ConversationState.AWAITING_INTEREST,
        currentState: ConversationState.HUMAN_HANDLING,
      },
      DEFAULT_TENANT_ID
    );

    // Simulasi: admin melepas label 'hold' di WA Business → event deleted
    const resEvent = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: labelEvent('label.chat.deleted', `${phone}@c.us`, 'hold'),
    });
    expect(JSON.parse(resEvent.body)).toEqual({ status: 'LABEL_EVENT_PROCESSED' });

    const refreshed = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
    expect(refreshed.is_hold_labeled).toBe(false);

    const getLabelsSpy = vi.spyOn(wahaClient, 'getChatLabels');
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: messagePayload(`msg_release_event_${Date.now()}`, phone),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'EVENT_PROCESSED' });

    const updatedConv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(updatedConv.is_human_handling).toBe(false);
    expect(getLabelsSpy).not.toHaveBeenCalled();
    getLabelsSpy.mockRestore();
  });

  it('label.chat.added (admin) → pesan masuk IGNORED_ADMIN lewat kolom DB tanpa getChatLabels', async () => {
    const phone = `6283333${Date.now()}`;
    await customerService.getOrCreateCustomer(phone, 'Admin Record', DEFAULT_TENANT_ID);

    const resEvent = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: labelEvent('label.chat.added', `${phone}@c.us`, 'Admin'),
    });
    expect(JSON.parse(resEvent.body)).toEqual({ status: 'LABEL_EVENT_PROCESSED' });

    const getLabelsSpy = vi.spyOn(wahaClient, 'getChatLabels');
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: messagePayload(`msg_admin_event_${Date.now()}`, phone),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'IGNORED_ADMIN' });
    expect(getLabelsSpy).not.toHaveBeenCalled();
    getLabelsSpy.mockRestore();
  });

  it('fallback tetap jalan: chat tanpa record customer → getChatLabels (mock WAHA) dipakai untuk deteksi Admin', async () => {
    const phone = `6283334${Date.now()}`;
    wahaClient.mockLabels.set(`${phone}@c.us`, ['Admin']);

    const getLabelsSpy = vi.spyOn(wahaClient, 'getChatLabelsOrNull');
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: messagePayload(`msg_admin_fallback_${Date.now()}`, phone),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'IGNORED_ADMIN' });
    expect(getLabelsSpy).toHaveBeenCalledWith(`${phone}@c.us`);

    getLabelsSpy.mockRestore();
    wahaClient.mockLabels.delete(`${phone}@c.us`);
  });


  it('event dengan label null (baru selesai scan QR) atau label non-admin/hold → dilewati dengan aman', async () => {
    const phone = `6283335${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Ignore Event', DEFAULT_TENANT_ID);

    // 1. label null → tidak merubah kolom
    const res1 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: labelEvent('label.chat.added', `${phone}@c.us`, null),
    });
    expect(res1.statusCode).toBe(200);
    expect(JSON.parse(res1.body)).toEqual({ status: 'LABEL_EVENT_PROCESSED' });

    // 2. label biasa (mis. 'legacy') → kolom admin/hold tidak berubah
    const res2 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: labelEvent('label.chat.added', `${phone}@c.us`, 'legacy'),
    });
    expect(JSON.parse(res2.body)).toEqual({ status: 'LABEL_EVENT_PROCESSED' });

    const refreshed = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
    expect(refreshed.is_hold_labeled).toBe(false);
    expect(refreshed.is_admin_labeled).toBe(false);
  });

  it('escalateToHumanHandling → addLabel hold sukses → kolom is_hold_labeled ikut ter-set true', async () => {
    const phone = `6283336${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Escalate Sync', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    await conversationService.escalateToHumanHandling(conversation, phone, 'test escalation', DEFAULT_TENANT_ID);

    const refreshed = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
    expect(refreshed.is_hold_labeled).toBe(true);
  });

  it('[TC 17] Malformed Webhook Payload → penanganan aman (return 200) tanpa melempar exception', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: { event: 'label.chat.added', session: 'default', payload: {} },
    });
    expect(res.statusCode).toBe(200);
  });

  it('[TC 18] Idempotent Webhook Delivery → menerima event label sama berulang kali tetap stabil', async () => {
    const phone = `6283337${Date.now()}`;
    await customerService.getOrCreateCustomer(phone, 'Idempotent Test', DEFAULT_TENANT_ID);

    const payload = labelEvent('label.chat.added', `${phone}@c.us`, 'hold');
    const res1 = await app.inject({ method: 'POST', url: '/webhook', payload });
    const res2 = await app.inject({ method: 'POST', url: '/webhook', payload });
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    const refreshed = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
    expect(refreshed.is_hold_labeled).toBe(true);
  });

  it('[TC 19] Case-insensitive Webhook Label Name → "HoLd" atau "ADMIN" terdeteksi dengan tepat', async () => {
    const phone = `6283338${Date.now()}`;
    await customerService.getOrCreateCustomer(phone, 'Case Insensitive Test', DEFAULT_TENANT_ID);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: labelEvent('label.chat.added', `${phone}@c.us`, 'HoLd'),
    });
    expect(res.statusCode).toBe(200);
    const refreshed = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
    expect(refreshed.is_hold_labeled).toBe(true);
  });

  it('[TC 20] Label event dengan format JID LID (@lid) → ter-resolve atau diabaikan tanpa error crash', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: labelEvent('label.chat.added', '1234567890@lid', 'hold'),
    });
    expect(res.statusCode).toBe(200);
  });
});

