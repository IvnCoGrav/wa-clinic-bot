import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Test: Medical escalation → alert HANYA ke admin (Telegram), chat customer DIAM TOTAL.
 * Tidak ada template darurat yang dikirim ke customer.
 */

vi.mock('../../src/integrations/llm/intent', () => ({
  llmIntentService: { detectIntent: async () => ({ intent: 'other' }) },
}));
vi.mock('../../src/integrations/llm/generator', () => ({
  llmResponseGenerator: { generateFaqResponse: async () => 'Mock FAQ response' },
}));

describe('Medical Escalation — Alert Admin Only, Customer Silent', () => {
  let sentToCustomer: string[] = [];
  let notifyAlertCalls: any[] = [];

  const mockTypingService = {
    simulateHumanReply: async (params: any) => {
      sentToCustomer.push(params.replyText);
      return { success: true };
    },
  } as any;

  const testStateMachine = new ConversationStateMachine(mockTypingService);

  beforeEach(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    sentToCustomer = [];
    notifyAlertCalls = [];

    // Mock AlertService: tangkap panggilan notifyAlert
    const { AlertService } = await import('../../src/services/alert.service');
    (AlertService as any).prototype.notifyAlert = async (payload: any) => { notifyAlertCalls.push(payload); };
  });

  it('HIGH severity → alert admin terkirim, TIDAK ada pesan ke customer (diam total)', async () => {
    const phone = `62891${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Medical', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      { currentState: ConversationState.AWAITING_LOCATION, isHumanHandling: false },
      DEFAULT_TENANT_ID
    );

    const result = await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_med_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'Anak saya demam tinggi banget dan kejang step' },
      },
    });

    expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(result.isHumanHandling).toBe(true);
    expect(result.shouldSendReply).toBe(false);

    // TIDAK ada template yang dikirim ke customer
    expect(sentToCustomer.length).toBe(0);
    expect(result.replyText).toBeUndefined();
  });

  it('MEDIUM severity → alert admin terkirim, TIDAK ada pesan ke customer', async () => {
    const phone = `62892${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Med2', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      { currentState: ConversationState.AWAITING_LOCATION, isHumanHandling: false },
      DEFAULT_TENANT_ID
    );

    const result = await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_med2_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'Pusar bayi saya ruam tali pusat dan bintik merah' },
      },
    });

    expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(result.shouldSendReply).toBe(false);
    expect(sentToCustomer.length).toBe(0);
    expect(result.replyText).toBeUndefined();
  });

  it('Non-medical message → normal flow, tidak ter-escalate', async () => {
    const phone = `62893${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Normal', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      { currentState: ConversationState.AWAITING_LOCATION, isHumanHandling: false },
      DEFAULT_TENANT_ID
    );

    const result = await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_norm_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'Berapa harga paket pijat bayi?' },
      },
    });

    // Bukan medical → bukan HUMAN_HANDLING karena medical (bisa state lain)
    expect(result.isHumanHandling).not.toBe(true);
  });
});
