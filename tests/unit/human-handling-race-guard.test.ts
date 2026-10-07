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
      // P3-2: manual = sewa 12 jam (conversation.service.ts:266-277), bukan abadi — 6h < 12h → belum release.
      const mockConv = {
        id: 'conv_1155',
        is_human_handling: true,
        human_handling_since: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago (<12h lease)
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
      // P3-2: 8h < 12h lease → belum release.
      const mockConv = {
        id: 'conv_dashboard',
        is_human_handling: true,
        human_handling_since: new Date(Date.now() - 8 * 60 * 60 * 1000), // 8 hours ago (<12h lease)
        escalation_reason: 'manual_takeover',
        previous_state: 'INITIAL',
        current_state: 'HUMAN_HANDLING',
      };

      const result = conversationService.checkAndApplyAutoRelease(mockConv, DEFAULT_TENANT_ID);
      expect(result.released).toBe(false);
      expect(result.updatedConversation.is_human_handling).toBe(true);
    });

    it('MUST NOT auto-release conversations escalated with any manual_ prefix', () => {
      // P3-2: 10h < 12h lease → belum release.
      const mockConv = {
        id: 'conv_manual_custom',
        is_human_handling: true,
        human_handling_since: new Date(Date.now() - 10 * 60 * 60 * 1000),
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

  describe('5. F3 — gerbang proaktif (bolehKirimProaktif)', () => {
    it('is_human_handling + aktivitas baru → DILARANG kirim proaktif', () => {
      expect(
        conversationService.bolehKirimProaktif(
          { is_human_handling: true, last_message_at: new Date() },
          { phone: '628111' }
        )
      ).toBe(false);
    });

    it('kontak admin/bypass → DILARANG', () => {
      expect(
        conversationService.bolehKirimProaktif({ is_human_handling: false }, { is_admin_labeled: true })
      ).toBe(false);
      expect(
        conversationService.bolehKirimProaktif(
          { is_human_handling: false },
          { labels: [{ label: { name: 'Skip' } }] }
        )
      ).toBe(false);
    });

    it('bot aktif & bukan bypass → BOLEH', () => {
      expect(
        conversationService.bolehKirimProaktif({ is_human_handling: false }, { phone: '628111' })
      ).toBe(true);
    });

    it('human handling tapi sudah lewat ambang jam → BOLEH', () => {
      const old = new Date(Date.now() - 100 * 3600000);
      expect(
        conversationService.bolehKirimProaktif({ is_human_handling: true, last_message_at: old }, {})
      ).toBe(true);
    });
  });

  describe('4. V-B — previous_state tidak boleh diracuni', () => {
    it('escalate saat SUDAH HUMAN_HANDLING tidak menimpa previous_state (undefined)', async () => {
      const spy = vi.spyOn(conversationService, 'updateConversationState').mockResolvedValue({} as any);
      await conversationService.escalateToHumanHandling(
        { id: 'conv_poison', current_state: ConversationState.HUMAN_HANDLING, customer: {} },
        '628123450001',
        'uji racun',
        DEFAULT_TENANT_ID,
        'manual_reply'
      );
      const patch = spy.mock.calls[0][1] as any;
      expect(patch.previousState).toBeUndefined();
    });

    it('escalate dari state riil menyimpan previous_state yang benar', async () => {
      const spy = vi.spyOn(conversationService, 'updateConversationState').mockResolvedValue({} as any);
      await conversationService.escalateToHumanHandling(
        { id: 'conv_ok', current_state: ConversationState.AWAITING_LOCATION, customer: {} },
        '628123450002',
        'uji normal',
        DEFAULT_TENANT_ID,
        'manual_reply'
      );
      const patch = spy.mock.calls[0][1] as any;
      expect(patch.previousState).toBe(ConversationState.AWAITING_LOCATION);
    });
  });
});
