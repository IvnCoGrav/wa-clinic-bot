import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationState } from '@prisma/client';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { messageService } from '../../src/services/message.service';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * MT-R4.1 (audit R4) — Pengiriman berhasil + logging gagal TIDAK BOLEH
 * menggagalkan turn. Jika throw, queue worker akan retry dan mengirim ulang
 * pesan yang sudah terkirim (balasan ganda ke customer).
 *
 * Kontrak: processMessage TIDAK melempar saat logMessage gagal setelah send.
 */
describe('Outbound log failure tidak memicu retry (R4)', () => {
  const sentToCustomer: string[] = [];
  const testStateMachine = new ConversationStateMachine({
    simulateHumanReply: async (params: any) => {
      sentToCustomer.push(params.replyText);
      return { success: true, bubblesSent: 1, messageId: 'wamid_test_1' };
    },
  } as any);

  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    sentToCustomer.length = 0;
    vi.restoreAllMocks();
  });

  it('logMessage throw setelah send → processMessage tetap selesai (tidak throw)', async () => {
    const phone = `62893${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Log Test', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    // V3 menghasilkan balasan sukses (tanpa LLM nyata).
    vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue({
      replyText: 'Baik Bunda, kami bantu ya.',
      executedTools: [],
      updatedSession: {} as any,
      shouldSendReply: true,
      isEscalated: false,
      retrievedChunks: [],
      fewShotExemplars: [],
      systemPrompt: '',
      reasoning: null,
      tokens: { prompt: 0, completion: 0, total: 0 },
      costIdr: 0,
      nextState: ConversationState.INITIAL,
    } as any);

    // Logging OUTBOUND GAGAL (mis. DB transient) — TIDAK boleh menggagalkan turn.
    // Hanya OUTBOUND yang digagalkan; log INBOUND (baris awal machine) tidak relevan di sini.
    vi.spyOn(messageService, 'logMessage').mockImplementation(async (arg: any) => {
      if (arg?.direction === 'OUTBOUND') throw new Error('Database offline');
      return undefined as any;
    });

    await expect(
      testStateMachine.processMessage({
        tenantId: DEFAULT_TENANT_ID,
        customer,
        conversation,
        incomingMessage: {
          id: `msg_log_${Date.now()}`,
          from: phone,
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'halo' },
        },
      } as any)
    ).resolves.toBeDefined();

    // Pesan tetap terkirim ke customer (sekali).
    expect(sentToCustomer.length).toBeGreaterThanOrEqual(1);
  });
});
