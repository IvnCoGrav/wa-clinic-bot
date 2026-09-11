import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationState } from '@prisma/client';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Fase A — Learning loop unresolved_faq (cakupan SEMPIT):
 * (i) turn dengan grounding kosong (search_knowledge_faq → chunks[]) tetap
 *     dibalas, tapi dicatat 'unresolved_faq' untuk kurasi admin;
 * (ii) eskalasi LLM non-medis dipetakan ke 'unresolved_faq' (medis tetap
 *     'medical_concern').
 */
describe('Unresolved FAQ writer — grounding kosong masuk antrean belajar', () => {
  const sentToCustomer: string[] = [];
  const testStateMachine = new ConversationStateMachine({
    simulateHumanReply: async (params: any) => {
      sentToCustomer.push(params.replyText);
      return { success: true };
    },
  } as any);

  function baseV3(overrides: any = {}) {
    return {
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
      ...overrides,
    } as any;
  }

  async function freshConversation(name: string) {
    const phone = `62893${Date.now()}${Math.floor(Math.random() * 1000)}`;
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
      id: `msg_ufq_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
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

  it('grounding kosong → balasan TERKIRIM + reason unresolved_faq', async () => {
    const { phone, customer } = await freshConversation('Bunda Siti');
    const escSpy = vi.spyOn(conversationService, 'escalateToHumanHandling');
    vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue(baseV3({
      executedTools: [{ name: 'search_knowledge_faq', args: { query: 'apakah boleh?' }, result: { success: true, chunks: [] } }],
      unresolvedFaq: true,
    }));

    const result = await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: sendBody('berapa harga pijat bayi?', phone),
    });

    // Balasan tetap keluar (tidak menahan jawaban dari customer).
    expect(result.shouldSendReply).toBe(true);
    expect(sentToCustomer.length).toBe(1);
    // Namun dicatat untuk kurasi admin.
    const reasons = escSpy.mock.calls.map((c) => c[4]);
    expect(reasons).toContain('unresolved_faq');
    const updated = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(updated.is_human_handling).toBe(true);
    expect(updated.escalation_reason).toBe('unresolved_faq');
  });

  it('grounding ada → TIDAK ada pencatatan unresolved_faq', async () => {
    const { phone, customer } = await freshConversation('Bunda Rina');
    const escSpy = vi.spyOn(conversationService, 'escalateToHumanHandling');
    vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue(baseV3({
      executedTools: [{ name: 'search_knowledge_faq', args: {}, result: { success: true, chunks: [{ id: '1' }] } }],
      unresolvedFaq: false,
    }));

    const result = await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: sendBody('berapa harga pijat bayi?', phone),
    });

    expect(result.shouldSendReply).toBe(true);
    expect(escSpy).not.toHaveBeenCalled();
    const updated = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(updated.is_human_handling).toBe(false);
  });

  it('eskalasi LLM non-medis → reason unresolved_faq', async () => {
    const { phone, customer } = await freshConversation('Bunda Dewi');
    const escSpy = vi.spyOn(conversationService, 'escalateToHumanHandling');
    vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue(baseV3({
      replyText: '',
      shouldSendReply: false,
      isEscalated: true,
      executedTools: [{ name: 'escalate_to_human', args: { severity: 'MANUAL_HANDLING', reason: 'tidak tahu jawab' }, result: { success: true, escalated: true } }],
    }));

    await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: sendBody('berapa harga pijat bayi?', phone),
    });

    const reasons = escSpy.mock.calls.map((c) => c[4]);
    expect(reasons).toContain('unresolved_faq');
    expect(sentToCustomer.length).toBe(0);
  });

  it('eskalasi LLM medis → reason medical_concern (tidak tercemar)', async () => {
    const { phone, customer } = await freshConversation('Bunda Ani');
    const escSpy = vi.spyOn(conversationService, 'escalateToHumanHandling');
    vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue(baseV3({
      replyText: '',
      shouldSendReply: false,
      isEscalated: true,
      executedTools: [{ name: 'escalate_to_human', args: { severity: 'CRITICAL_MEDICAL', reason: 'bayi kejang' }, result: { success: true, escalated: true } }],
    }));

    await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: sendBody('berapa harga pijat bayi?', phone),
    });

    const reasons = escSpy.mock.calls.map((c) => c[4]);
    expect(reasons).toContain('medical_concern');
    expect(reasons).not.toContain('unresolved_faq');
  });
});
