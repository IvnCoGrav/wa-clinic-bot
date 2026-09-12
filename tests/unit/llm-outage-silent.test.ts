import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationState } from '@prisma/client';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { GenerationStage } from '../../src/v3/agent/pipeline/generation-stage';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Fase B — Outage LLM total: TANPA balasan generik tanya-alamat.
 * Runner mengembalikan eskalasi sunyi; machine mencatat & memberi tahu CS.
 */
describe('LLM outage — eskalasi sunyi tanpa balasan', () => {
  const sentToCustomer: string[] = [];
  const testStateMachine = new ConversationStateMachine({
    simulateHumanReply: async (params: any) => {
      sentToCustomer.push(params.replyText);
      return { success: true };
    },
  } as any);

  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    sentToCustomer.length = 0;
    vi.restoreAllMocks();
  });

  it('Call-1 LLM throw → sunyi total, eskalasi tercatat, nol teks keluar', async () => {
    const phone = `62892${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Sari', DEFAULT_TENANT_ID);
    const escSpy = vi.spyOn(conversationService, 'escalateToHumanHandling');
    vi.spyOn(GenerationStage, 'executeChatCompletion').mockRejectedValue(new Error('LLM outage simulasi'));

    const result = await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_out_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'berapa harga pijat bayi?' },
      },
    });

    expect(result.shouldSendReply).toBe(false);
    expect(result.replyText).toBeFalsy();
    expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(sentToCustomer.length).toBe(0);

    const reasons = escSpy.mock.calls.map((c) => c[4]);
    expect(reasons.length).toBeGreaterThan(0);
    const updated = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(updated.is_human_handling).toBe(true);
  });
});
