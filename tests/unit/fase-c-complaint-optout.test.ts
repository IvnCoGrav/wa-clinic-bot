import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationState } from '@prisma/client';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { EntityExtractor } from '../../src/services/entity-extractor.service';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Fase C — (C1) complaint/human_agent → eskalasi sunyi; (C2) opt-out STOP
 * berlaku semua provider; (C3) slash command setelah gate medis/domain.
 */
describe('Fase C — keluhan, opt-out lintas provider, urutan command', () => {
  const sentToCustomer: string[] = [];
  const testStateMachine = new ConversationStateMachine({
    simulateHumanReply: async (params: any) => {
      sentToCustomer.push(params.replyText);
      return { success: true };
    },
  } as any);

  const v3MockResult = {
    replyText: 'mocked-v3-reply',
    executedTools: [],
    updatedSession: {},
    shouldSendReply: true,
    isEscalated: false,
    retrievedChunks: [],
    fewShotExemplars: [],
    systemPrompt: '',
    reasoning: null,
    tokens: { prompt: 0, completion: 0, total: 0 },
    costIdr: 0,
  } as any;

  function fullExtraction(intents: string[]) {
    return {
      intents,
      locationText: null,
      comparisonLocations: null,
      streetDetail: null,
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.9,
      clearedSlots: null,
    } as any;
  }

  async function freshConversation(name: string) {
    const phone = `62891${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, name, DEFAULT_TENANT_ID);
    await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      (await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID)).id,
      { currentState: ConversationState.INITIAL, isHumanHandling: false },
      DEFAULT_TENANT_ID
    );
    return { phone, customer };
  }

  function sendBody(body: string, phone: string, extra: any = {}) {
    return {
      id: `msg_fc_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      from: phone,
      timestamp: '1700000000',
      type: 'text',
      text: { body },
      ...extra,
    };
  }

  async function runTurn(customer: any, msg: any) {
    return testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: msg,
    });
  }

  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    sentToCustomer.length = 0;
    vi.restoreAllMocks();
  });

  it('C1: "saya mau komplain" → sunyi, reason complaint, V3 tak dipanggil', async () => {
    const { phone, customer } = await freshConversation('Bunda Komplain');
    const extractSpy = vi.spyOn(EntityExtractor, 'extract').mockResolvedValue(fullExtraction(['complaint']));
    const v3Spy = vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue(v3MockResult);

    const result = await runTurn(customer, sendBody('saya kecewa, mau komplain pelayanan kemarin', phone));

    expect(extractSpy).toHaveBeenCalled();
    expect(v3Spy).not.toHaveBeenCalled();
    expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(result.shouldSendReply).toBe(false);
    expect(sentToCustomer.length).toBe(0);
    const updated = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(updated.escalation_reason).toBe('complaint');
  });

  it('C1: "minta admin" → sunyi, reason manual_request', async () => {
    const { phone, customer } = await freshConversation('Bunda Admin');
    vi.spyOn(EntityExtractor, 'extract').mockResolvedValue(fullExtraction(['human_agent']));
    const v3Spy = vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue(v3MockResult);

    const result = await runTurn(customer, sendBody('bisa bicara dengan adminnya langsung?', phone));

    expect(v3Spy).not.toHaveBeenCalled();
    expect(result.shouldSendReply).toBe(false);
    expect(sentToCustomer.length).toBe(0);
    const updated = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(updated.escalation_reason).toBe('manual_request');
  });

  it('C1: gejala fisik "bayi ruam" TIDAK dianggap complaint (tetap ke V3)', async () => {
    const { phone, customer } = await freshConversation('Bunda Ruam');
    vi.spyOn(EntityExtractor, 'extract').mockResolvedValue(fullExtraction(['consult_symptom']));
    const v3Spy = vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue(v3MockResult);

    await runTurn(customer, sendBody('bayi saya ruam setelah pijat', phone));

    expect(v3Spy).toHaveBeenCalledTimes(1);
  });

  it('C2: "STOP" via WAHA (tanpa _provider WABA) → opt-out sunyi', async () => {
    const { phone, customer } = await freshConversation('Bunda Stop');
    const v3Spy = vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue(v3MockResult);

    const result = await runTurn(customer, sendBody('STOP', phone));

    expect(v3Spy).not.toHaveBeenCalled();
    expect(result.shouldSendReply).toBe(false);
  });

  it('C3: "/reset" saat is_human_handling → tetap sunyi (tak menyela CS)', async () => {
    const { phone, customer } = await freshConversation('Bunda Reset');
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.escalateToHumanHandling(conv, phone, 'uji', DEFAULT_TENANT_ID, 'manual_request');
    const v3Spy = vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue(v3MockResult);

    const result = await runTurn(customer, sendBody('/reset', phone));

    expect(v3Spy).not.toHaveBeenCalled();
    expect(result.shouldSendReply).toBe(false);
    expect(sentToCustomer.length).toBe(0);
  });
});
