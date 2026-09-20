import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationState } from '@prisma/client';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { GenerationStage } from '../../src/v3/agent/pipeline/generation-stage';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Stage 4 (R2) — idle reset WAJIB menyelaraskan sesi V3 episodik.
 * Sebelumnya hanya enum conversation yang direset; session V3 (cart, treatment,
 * booking, komitmen) tetap terbaca ulang → "amnesia palsu"/konteks lama nyangkut.
 */
describe('Idle reset membersihkan sesi V3 episodik (Stage 4 / R2)', () => {
  const testStateMachine = new ConversationStateMachine({
    simulateHumanReply: async () => ({ success: true, bubblesSent: 1 }),
  } as any);

  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    vi.restoreAllMocks();
  });

  it('konversasi idle > timeout → reset enum + bersihkan sesi V3 episodik', async () => {
    const phone = `62894${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Idle', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    // last_message_at 15 hari lalu (> IDLE default 14,1 hari per CG-02)
    const stale = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    conversation.last_message_at = stale;
    conversation.current_state = ConversationState.AWAITING_INTEREST;

    const goalSessionSpy = vi.spyOn(GoalTracker, 'updateGoalSession').mockResolvedValue({} as any);
    // Cegah pipeline V3 nyata (LLM) — cukup fokus pada blok idle reset.
    vi.spyOn(GenerationStage, 'executeChatCompletion').mockRejectedValue(new Error('LLM unavailable in test'));

    await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation,
      incomingMessage: {
        id: `msg_idle_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'halo lagi' },
      },
    } as any);

    // Wajib ada pemanggilan updateGoalSession yang membersihkan cartItems.
    const clearedCall = goalSessionSpy.mock.calls.find(
      (c) => c[1] && Array.isArray((c[1] as any).cartItems) && (c[1] as any).cartItems.length === 0
        && (c[1] as any).lastCommitment === undefined
    );
    expect(clearedCall).toBeTruthy();
  });
});
