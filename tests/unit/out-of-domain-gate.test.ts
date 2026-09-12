import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationState } from '@prisma/client';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { EntityExtractor } from '../../src/services/entity-extractor.service';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Mekanisme B — Gate domain di state machine: intent "out_of_domain" dari NLU
 * → eskalasi sunyi SEBELUM V3 (0 token, 0 balasan). Pasca kolaps split-brain,
 * seam NLU adalah preExtractDeterministic (0 token); keputusan domain tetap
 * berasal dari klasifikasi, bukan daftar kata topik.
 */
describe('Domain Gate — out_of_domain → eskalasi sunyi pre-V3', () => {
  const sentToCustomer: string[] = [];
  const mockTypingService = {
    simulateHumanReply: async (params: any) => {
      sentToCustomer.push(params.replyText);
      return { success: true };
    },
  } as any;
  const testStateMachine = new ConversationStateMachine(mockTypingService);

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

  function detExtraction(intents: string[]) {
    return { intents } as any;
  }

  async function freshConversation(name: string) {
    const phone = `62894${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, name, DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      { currentState: ConversationState.INITIAL, isHumanHandling: false },
      DEFAULT_TENANT_ID
    );
    return { phone, customer, conversation };
  }

  function sendBody(body: string, phone: string) {
    return {
      id: `msg_ood_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      from: phone,
      timestamp: '1700000000',
      type: 'text',
      text: { body },
    };
  }

  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    sentToCustomer.length = 0;
    vi.restoreAllMocks();
  });

  it('out_of_domain → HUMAN_HANDLING sunyi, V3 TIDAK dipanggil', async () => {
    const { phone, customer, conversation } = await freshConversation('Rizki Dwi S');
    const extractSpy = vi.spyOn(EntityExtractor, 'preExtractDeterministic').mockReturnValue(detExtraction(['out_of_domain']));
    const v3Spy = vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue(v3MockResult);

    const result = await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: sendBody('Pagi kak mau tanya lokernya masih tersedia ?', phone),
    });

    expect(extractSpy).toHaveBeenCalled();
    expect(v3Spy).not.toHaveBeenCalled();
    expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(result.isHumanHandling).toBe(true);
    expect(result.shouldSendReply).toBe(false);
    expect(sentToCustomer.length).toBe(0);

    const updated = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(updated.is_human_handling).toBe(true);
    expect(updated.escalation_reason).toBe('out_of_domain');
  });

  it('kontrol fast-path: sinyal deterministik (harga) → NLU dilewati, V3 jalan', async () => {
    const { phone, customer, conversation } = await freshConversation('Bunda Kontrol');
    const extractSpy = vi.spyOn(EntityExtractor, 'preExtractDeterministic').mockReturnValue(detExtraction(['chitchat']));
    const v3Spy = vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue(v3MockResult);

    const result = await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: sendBody('Berapa harga paket pijat bayi?', phone),
    });

    // 'harga' memicu fast intent → tidak perlu panggilan NLU LLM.
    expect(extractSpy).not.toHaveBeenCalled();
    expect(v3Spy).toHaveBeenCalledTimes(1);
    expect(result.isHumanHandling).not.toBe(true);
  });

  it('kontrol disambiguasi: fast kosong + hasil chitchat → V3 jalan, tidak tereskalasi', async () => {
    const { phone, customer, conversation } = await freshConversation('Bunda Makasih');
    const extractSpy = vi.spyOn(EntityExtractor, 'preExtractDeterministic').mockReturnValue(detExtraction(['chitchat']));
    const v3Spy = vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue(v3MockResult);

    const result = await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: sendBody('makasih banyak kak', phone),
    });

    expect(extractSpy).toHaveBeenCalled();
    expect(v3Spy).toHaveBeenCalledTimes(1);
    expect(result.isHumanHandling).not.toBe(true);
  });

  it('replay 3-turn kasus live: semua sunyi, V3 tak pernah dipanggil, tanpa loop balasan', async () => {
    const { phone, customer } = await freshConversation('Rizki Dwi S');
    const extractSpy = vi.spyOn(EntityExtractor, 'preExtractDeterministic').mockReturnValue(detExtraction(['out_of_domain']));
    const v3Spy = vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue(v3MockResult);

    const turns = [
      'Pagi kak mau tanya lokernya masih tersedia ?',
      'Lokernya masih tersedia kak ?',
      'Lokernya masih tersedia kak ?',
    ];
    for (const body of turns) {
      const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
      const result = await testStateMachine.processMessage({
        tenantId: DEFAULT_TENANT_ID,
        customer,
        conversation: conv,
        incomingMessage: sendBody(body, phone),
      });
      // Turn 1: gate eskalasi (isHumanHandling true). Turn 2+: guard HUMAN_HANDLING
      // existing (sunyi, tanpa field isHumanHandling). Semua: tanpa balasan, tanpa V3.
      expect(result.shouldSendReply).toBe(false);
      expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    }

    expect(v3Spy).not.toHaveBeenCalled();
    expect(sentToCustomer.length).toBe(0);
    const updated = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(updated.is_human_handling).toBe(true);
    expect(updated.escalation_reason).toBe('out_of_domain');
  });

  it('kontrak V3: preExtractedIntents out_of_domain → eskalasi tanpa LLM (serukan langsung)', async () => {    const v3out = await V3AgentRunner.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-ood-1',
      conversationId: 'conv-ood-1',
      phone: '6289400000001',
      chatId: '6289400000001@c.us',
      incomingText: 'topik asing apa pun',
      history: [],
      skipDbLogging: true,
      preExtractedIntents: ['out_of_domain'],
    } as any);

    expect(v3out.isEscalated).toBe(true);
    expect(v3out.shouldSendReply).toBe(false);
    expect(v3out.replyText).toBe('');
    expect(v3out.executedTools).toEqual([]);
    expect(v3out.nextState).toBe(ConversationState.HUMAN_HANDLING);
  });
});
