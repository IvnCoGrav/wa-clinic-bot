import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationService } from '../../src/services/conversation.service';
import { TypingService } from '../../src/services/typing.service';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { ConversationState } from '@prisma/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Human Handling & Anti-Race Guards (Case #1155 & #319)', () => {
  let conversationService: ConversationService;

  beforeEach(() => {
    vi.clearAllMocks();
    conversationService = new ConversationService();
  });

  describe('1. Auto-Release Exemption (Case #1155 Bunda Inez)', () => {
    it('MUST NOT auto-release conversations escalated via manual_reply (WhatsApp HP)', () => {
      const mockConv = {
        id: 'conv_1155',
        is_human_handling: true,
        human_handling_since: new Date(Date.now() - 20 * 60 * 60 * 1000), // 20 hours ago
        escalation_reason: 'manual_reply',
        previous_state: 'INITIAL',
        current_state: 'HUMAN_HANDLING',
      };

      const result = conversationService.checkAndApplyAutoRelease(mockConv, DEFAULT_TENANT_ID);
      expect(result.released).toBe(false);
      expect(result.updatedConversation.is_human_handling).toBe(true);
      expect(result.updatedConversation.current_state).toBe('HUMAN_HANDLING');
    });

    it('MUST NOT auto-release conversations escalated via manual_takeover / admin_takeover (Dashboard)', () => {
      const mockConv = {
        id: 'conv_dashboard',
        is_human_handling: true,
        human_handling_since: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        escalation_reason: 'manual_takeover',
        previous_state: 'INITIAL',
        current_state: 'HUMAN_HANDLING',
      };

      const result = conversationService.checkAndApplyAutoRelease(mockConv, DEFAULT_TENANT_ID);
      expect(result.released).toBe(false);
      expect(result.updatedConversation.is_human_handling).toBe(true);
    });

    it('MUST NOT auto-release conversations escalated with any manual_ prefix', () => {
      const mockConv = {
        id: 'conv_manual_custom',
        is_human_handling: true,
        human_handling_since: new Date(Date.now() - 30 * 60 * 60 * 1000),
        escalation_reason: 'manual_cs_hold',
        previous_state: 'INITIAL',
        current_state: 'HUMAN_HANDLING',
      };

      const result = conversationService.checkAndApplyAutoRelease(mockConv, DEFAULT_TENANT_ID);
      expect(result.released).toBe(false);
      expect(result.updatedConversation.is_human_handling).toBe(true);
    });
  });

  describe('2. State Machine Human Handling Abort Guard (Case #319)', () => {
    it('should immediately abort processMessage without sending reply if conversation is in HUMAN_HANDLING', async () => {
      const stateMachine = new ConversationStateMachine();
      const mockContext: any = {
        tenantId: DEFAULT_TENANT_ID,
        customer: { id: 'cust_319', phone: '6285655986319', status: 'active' },
        conversation: {
          id: 'conv_319',
          current_state: ConversationState.HUMAN_HANDLING,
          is_human_handling: true,
        },
        incomingMessage: { id: 'msg_319_2', text: { body: 'Ada gerai nya?' } },
      };

      const result = await stateMachine.processMessage(mockContext);
      expect(result.shouldSendReply).toBe(false);
      expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    });
  });

  describe('3. Typing Simulation Real-Time In-Flight Abort (Case #319)', () => {
    it('should abort simulateHumanReply before sending text if shouldAbort returns true during typing delay', async () => {
      const mockWahaClient: any = {
        sendSeen: vi.fn().mockResolvedValue(true),
        startTyping: vi.fn().mockResolvedValue(true),
        stopTyping: vi.fn().mockResolvedValue(true),
        sendText: vi.fn().mockResolvedValue(true),
      };

      const typingSvc = new TypingService(mockWahaClient, 100); // speed up delays for test

      const result = await typingSvc.simulateHumanReply({
        chatId: '6285655986319@c.us',
        incomingMessageId: 'msg_1',
        incomingText: 'Halo',
        replyText: 'Halo Bunda kami melayani homecare',
        shouldAbort: () => true, // Simulate CS taking over during typing
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('ABORTED_BY_HUMAN_HANDLING');
      expect(result.bubblesSent).toBe(0);
      expect(mockWahaClient.sendText).not.toHaveBeenCalled();
    });
  });
});
