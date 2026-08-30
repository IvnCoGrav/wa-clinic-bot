import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { stateMachine } from '../../src/state-machine/machine';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { prisma } from '../../src/db/client';

describe('State Machine & Conversation Orchestrator Unit Tests', () => {
  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    vi.restoreAllMocks();
    (prisma.conversation as any).update = vi.fn().mockImplementation(() => {
      const p = Promise.resolve({} as any);
      (p as any).catch = () => p;
      return p;
    });
  });

  it('5. AUTO-RELEASE TIMEOUT: Restores current_state to previous_state after > 6 hours timeout', async () => {
    const phone = `62855${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Eko', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
    await conversationService.updateConversationState(
      conversation.id,
      {
        currentState: ConversationState.HUMAN_HANDLING,
        previousState: ConversationState.AWAITING_LOCATION,
        isHumanHandling: true,
        humanHandlingSince: sevenHoursAgo,
      },
      DEFAULT_TENANT_ID
    );

    const convBefore = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    const autoReleaseResult = conversationService.checkAndApplyAutoRelease(convBefore, DEFAULT_TENANT_ID);

    expect(autoReleaseResult.released).toBe(true);
    expect(autoReleaseResult.updatedConversation.is_human_handling).toBe(false);
    expect(autoReleaseResult.updatedConversation.current_state).toBe(ConversationState.AWAITING_LOCATION);
  });
});
