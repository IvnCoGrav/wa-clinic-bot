import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { queueService } from '../../src/services/queue.service';
import { wahaClient } from '../../src/integrations/waha/client';
import { FastifyInstance } from 'fastify';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Skema Testing Full Cycle: Bot Toggle ON/OFF & Kirim Pesan', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    await seedAiScopeAll();
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  it('Verifikasi Lengkap: AI Chatbot Aktif Saat ON -> Silent Saat TOGGLE OFF -> Aktif Kembali Saat TOGGLE ON', async () => {
    const phone = `628555${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Pelanggan Uji Toggle', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    // ==========================================
    // FASE 1: BOT TOGGLE ON (NORMAL / BOT MODE)
    // ==========================================
    const payloadPhase1 = {
      event: 'message',
      session: 'default',
      payload: {
        id: `msg_on_1_${Date.now()}`,
        from: `${phone}@c.us`,
        fromMe: false,
        timestamp: 1700000000,
        body: 'Halo Bidan, apakah klinik buka hari ini?',
      },
    };

    const resPhase1 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: payloadPhase1,
    });

    expect(resPhase1.statusCode).toBe(200);
    const body1 = JSON.parse(resPhase1.body);
    // Verifikasi bahwa bot AKTIF dan memproses pesan (Status: EVENT_PROCESSED)
    expect(body1.status).toBe('EVENT_PROCESSED');

    // ==========================================
    // FASE 2: TOGGLE BOT OFF (HUMAN HANDLING MODE)
    // ==========================================
    // Admin melakukan takeover / toggle OFF untuk percakapan ini
    await conversationService.updateConversationState(
      conversation.id,
      {
        isHumanHandling: true,
        humanHandlingSince: new Date(),
        escalationReason: 'admin_toggle_off',
      },
      DEFAULT_TENANT_ID
    );
    await wahaClient.addLabel(`${phone}@c.us`, 'hold');

    const payloadPhase2 = {
      event: 'message',
      session: 'default',
      payload: {
        id: `msg_off_2_${Date.now()}`,
        from: `${phone}@c.us`,
        fromMe: false,
        timestamp: 1700000001,
        body: 'Halo, kok bot tidak membalas? Ada admin manusia?',
      },
    };

    const resPhase2 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: payloadPhase2,
    });

    expect(resPhase2.statusCode).toBe(200);
    const body2 = JSON.parse(resPhase2.body);
    // Verifikasi bahwa guard clause AKTIF mem-bypass balasan AI (Status: HUMAN_HANDLING_ACTIVE_SILENT)
    expect(body2.status).toBe('HUMAN_HANDLING_ACTIVE_SILENT');

    // ==========================================
    // FASE 3: TOGGLE BOT ON KEMBALI (RELEASE HUMAN HANDLING)
    // ==========================================
    // Admin mengembalikan kontrol ke Bot (Release)
    await conversationService.updateConversationState(
      conversation.id,
      {
        isHumanHandling: false,
        humanHandlingSince: null,
        escalationReason: null,
      },
      DEFAULT_TENANT_ID
    );
    await wahaClient.removeLabel(`${phone}@c.us`, 'hold');

    const payloadPhase3 = {
      event: 'message',
      session: 'default',
      payload: {
        id: `msg_on_3_${Date.now()}`,
        from: `${phone}@c.us`,
        fromMe: false,
        timestamp: 1700000002,
        body: 'Terima kasih, mau tanya lokasi klinik dimana?',
      },
    };

    const resPhase3 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: payloadPhase3,
    });

    expect(resPhase3.statusCode).toBe(200);
    const body3 = JSON.parse(resPhase3.body);
    // Verifikasi bahwa bot KEMBALI AKTIF dan merespons otomatis (Status: EVENT_PROCESSED)
    expect(body3.status).toBe('EVENT_PROCESSED');
  });

  it('Verifikasi Auto-Release Global Bot Toggle: saat globalBotActive = true via PATCH API, percakapan otomatis di-release dari Human Handling', async () => {
    const { AiModelConfigService } = await import('../../src/config/ai-models.config');
    const phone = `628556${Date.now()}`;
    const cust = await customerService.getOrCreateCustomer(phone, 'Customer Global Toggle', DEFAULT_TENANT_ID);
    const conv = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);

    // 1. Matikan global bot
    AiModelConfigService.globalBotActive = false;

    // 2. Kirim pesan -> percakapan ter-escalate dengan reason 'Global bot disabled'
    await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        event: 'message',
        session: 'default',
        payload: {
          id: `msg_global_off_${Date.now()}`,
          from: `${phone}@c.us`,
          fromMe: false,
          timestamp: Math.floor(Date.now() / 1000),
          body: 'Halo saat bot off',
        },
      },
    });

    // Tunggu queue worker selesai memproses escalation
    await new Promise((resolve) => setTimeout(resolve, 100));

    const checkConvOff = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    expect(checkConvOff.is_human_handling).toBe(true);

    // 3. Admin panggil PATCH /api/admin/settings dengan globalBotActive: true
    const resPatch = await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { globalBotActive: true },
    });

    expect(resPatch.statusCode).toBe(200);

    // 4. Verifikasi percakapan otomatis di-release
    const checkConvOn = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    expect(checkConvOn.is_human_handling).toBe(false);

    // 5. Pesan baru berikutnya dari customer langsung dibalas AI (EVENT_PROCESSED)
    const resMessageNew = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        event: 'message',
        session: 'default',
        payload: {
          id: `msg_global_on_${Date.now()}`,
          from: `${phone}@c.us`,
          fromMe: false,
          timestamp: Math.floor(Date.now() / 1000),
          body: 'Halo bot, apakah sudah aktif?',
        },
      },
    });

    expect(resMessageNew.statusCode).toBe(200);
    expect(JSON.parse(resMessageNew.body)).toEqual({ status: 'EVENT_PROCESSED' });
  });
});
