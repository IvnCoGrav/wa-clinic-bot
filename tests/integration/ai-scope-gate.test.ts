import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { conversationService } from '../../src/services/conversation.service';
import { queueService } from '../../src/services/queue.service';
import { AiEligibilityConfigService } from '../../src/config/ai-eligibility-config';
import { AiCustomerScope, ConversationState } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { AI_ELIGIBILITY_ESCALATION_REASON } from '../../src/services/ai-eligibility.service';

/**
 * Integration test AI Rollout Scope Gate via POST /webhook (end-to-end):
 * scope NEW_ONLY + cutoff di masa depan → semua customer baru terhitung "legacy"
 * → pesan pertama di-INITIAL di-senyapkan: status AI_SCOPE_INELIGIBLE_SILENCED,
 * conversation masuk HUMAN_HANDLING dengan escalation_reason khusus.
 *
 * CATATAN: config di-seed via saveConfig (cache in-memory; DB mock offline di
 * test). Setelah test, config di-restore ke ALL supaya tidak memengaruhi file
 * test lain di worker yang sama.
 */
describe('AI Rollout Scope Gate Integration (WAHA webhook)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    await AiEligibilityConfigService.saveConfig(DEFAULT_TENANT_ID, {
      ai_customer_scope: AiCustomerScope.NEW_ONLY,
      ai_scope_cutoff_at: new Date('2099-01-01T00:00:00Z'), // semua customer sekarang = legacy
    });
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await AiEligibilityConfigService.saveConfig(DEFAULT_TENANT_ID, {
      ai_customer_scope: AiCustomerScope.ALL,
      ai_scope_cutoff_at: new Date(0),
    });
    await app.close();
    await queueService.close();
  });

  it('legacy customer baru di INITIAL di-senyapkan & diarahkan ke human handling', async () => {
    const phone = `6289${Date.now().toString().slice(-9)}`;
    const waMessageId = `ai_scope_${Date.now()}`;
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: waMessageId,
        from: `${phone}@c.us`,
        fromMe: false,
        timestamp: 1700000000,
        body: 'Halo bunda',
        _data: { notifyName: 'Customer Legacy' },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'AI_SCOPE_INELIGIBLE_SILENCED' });

    // Conversation sudah masuk HUMAN_HANDLING dengan escalation_reason khusus
    const { customerService } = await import('../../src/services/customer.service');
    const cust = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
    expect(cust).toBeTruthy();
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    expect(conversation.is_human_handling).toBe(true);
    expect(conversation.escalation_reason).toBe(AI_ELIGIBILITY_ESCALATION_REASON);
  });

  it('scope ALL (rollout full) mengembalikan perilaku lama — legacy tidak disenyapkan', async () => {
    await AiEligibilityConfigService.saveConfig(DEFAULT_TENANT_ID, {
      ai_customer_scope: AiCustomerScope.ALL,
      ai_scope_cutoff_at: new Date(0),
    });

    const phone = `6281${Date.now().toString().slice(-9)}`;
    const waMessageId = `ai_scope_all_${Date.now()}`;
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: waMessageId,
        from: `${phone}@c.us`,
        fromMe: false,
        timestamp: 1700000000,
        body: 'Halo bunda',
        _data: { notifyName: 'Customer ALL' },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });

    expect(res.statusCode).toBe(200);
    // Bukan silence — pesan lanjut ke pipeline normal
    expect(JSON.parse(res.body).status).not.toBe('AI_SCOPE_INELIGIBLE_SILENCED');
  });

  it('boot DB offline → fail-closed (NEW_ONLY cutoff=now) silence customer baru; pulih ALL → AI aktif', async () => {
    const { customerService } = await import('../../src/services/customer.service');

    // Simulasi outage: customer dibuat SEBELUM config hilang, lalu cache dikosongkan
    // (seperti boot tanpa loadConfigsFromDb yang berhasil / DB restart).
    const phone = `6282${Date.now().toString().slice(-9)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Customer Outage', DEFAULT_TENANT_ID);
    expect(customer.created_at.getTime()).toBeLessThanOrEqual(Date.now());
    await new Promise((r) => setTimeout(r, 20));
    AiEligibilityConfigService.clearCache(DEFAULT_TENANT_ID);

    // Pesan pertama saat config tidak tersedia → default fail-closed silences
    // BAHKAN customer yang baru saja dibuat (cutoff=now > createdAt).
    const waMessageId = `ai_scope_outage_${Date.now()}`;
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: waMessageId,
        from: `${phone}@c.us`,
        fromMe: false,
        timestamp: 1700000000,
        body: 'Halo bunda',
        _data: { notifyName: 'Customer Outage' },
      },
    };

    const res = await app.inject({ method: 'POST', url: '/webhook', payload });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'AI_SCOPE_INELIGIBLE_SILENCED' });

    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(conversation.is_human_handling).toBe(true);
    expect(conversation.escalation_reason).toBe(AI_ELIGIBILITY_ESCALATION_REASON);

    // DB pulih: config di-load ulang dengan scope ALL (full rollout).
    await AiEligibilityConfigService.saveConfig(DEFAULT_TENANT_ID, {
      ai_customer_scope: AiCustomerScope.ALL,
      ai_scope_cutoff_at: new Date(0),
    });

    // Release hold (simulasi admin membuka conversation setelah config pulih).
    await conversationService.updateConversationState(
      conversation.id,
      {
        currentState: ConversationState.INITIAL,
        isHumanHandling: false,
        humanHandlingSince: null,
        escalationReason: null,
      },
      DEFAULT_TENANT_ID
    );

    // Pesan berikutnya dari customer yang sama → AI aktif normal, bukan silence.
    const res2 = await app.inject({ method: 'POST', url: '/webhook', payload });
    expect(res2.statusCode).toBe(200);
    expect(JSON.parse(res2.body).status).not.toBe('AI_SCOPE_INELIGIBLE_SILENCED');
  });
});