import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { messageService } from '../../src/services/message.service';
import { messagePinService } from '../../src/services/message-pin.service';
import { messageReactionService } from '../../src/services/message-reaction.service';
import { messageReadStatusService } from '../../src/services/message-read-status.service';

const TENANT = 'default-tenant';

describe('Message Services Modular Split (SM-01)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. messagePinService & Facade Parity', () => {
    it('toggleMessagePin & getPinnedMessage work correctly via messagePinService and messageService facade', async () => {
      const convId = 'conv-pin-1';
      const msgId = 'msg-pin-1';

      const mockMsg = {
        id: msgId,
        conversation_id: convId,
        tenant_id: TENANT,
        content: 'Halo Bunda, ada yang bisa dibantu?',
        sender_type: 'BOT',
        sender_name: 'Bidan Bot',
        created_at: new Date(),
        payload_raw: {},
      };

      vi.mocked(prisma.message.findFirst).mockResolvedValue(mockMsg as any);
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: convId,
        tenant_id: TENANT,
        session_data: {},
      } as any);

      // Test direct service
      const res1 = await messagePinService.toggleMessagePin(convId, msgId, TENANT, 'Admin Test', true);
      expect(res1.success).toBe(true);
      expect(res1.isPinned).toBe(true);

      // Test facade parity
      const res2 = await messageService.toggleMessagePin(convId, msgId, TENANT, 'Admin Test', false);
      expect(res2.success).toBe(true);
      expect(res2.isPinned).toBe(false);
    });

    it('toggleMessageHide toggles is_hidden flag correctly via service and facade', async () => {
      const convId = 'conv-hide-1';
      const msgId = 'msg-hide-1';

      const mockMsg = {
        id: msgId,
        conversation_id: convId,
        tenant_id: TENANT,
        content: 'Pesan rahasia',
        sender_type: 'CUSTOMER',
        created_at: new Date(),
        payload_raw: { is_hidden: false },
      };

      vi.mocked(prisma.message.findFirst).mockResolvedValue(mockMsg as any);
      vi.mocked(prisma.message.updateMany).mockResolvedValue({ count: 1 } as any);

      const hideRes = await messagePinService.toggleMessageHide(convId, msgId, TENANT, 'Admin Test', true);
      expect(hideRes.success).toBe(true);
      expect(hideRes.isHidden).toBe(true);

      const facadeRes = await messageService.toggleMessageHide(convId, msgId, TENANT, 'Admin Test', false);
      expect(facadeRes.success).toBe(true);
      expect(facadeRes.isHidden).toBe(false);
    });
  });

  describe('2. messageReactionService & Facade Parity', () => {
    it('addOrUpdateReaction adds and clears reaction via service and facade', async () => {
      const msgId = 'msg-react-1';
      const convId = 'conv-react-1';

      const mockMsg = {
        id: msgId,
        conversation_id: convId,
        tenant_id: TENANT,
        payload_raw: { reactions: [] },
      };

      vi.mocked(prisma.message.findFirst).mockResolvedValue(mockMsg as any);
      vi.mocked(prisma.message.updateMany).mockResolvedValue({ count: 1 } as any);

      // Add reaction
      const resAdd = await messageReactionService.addOrUpdateReaction(msgId, TENANT, {
        emoji: '❤️',
        fromMe: true,
        actorId: 'admin-1',
      });
      expect(resAdd.success).toBe(true);
      expect(resAdd.reactions?.some((r) => r.emoji === '❤️')).toBe(true);

      // Facade parity: remove reaction (empty emoji)
      const resRemove = await messageService.addOrUpdateReaction(msgId, TENANT, {
        emoji: '',
        fromMe: true,
        actorId: 'admin-1',
      });
      expect(resRemove.success).toBe(true);
      expect(resRemove.reactions?.some((r) => r.emoji === '❤️')).toBe(false);
    });
  });

  describe('3. messageReadStatusService & Facade Parity', () => {
    it('markConversationMessagesAsRead and unread batching work via service and facade', async () => {
      const convId = 'conv-read-1';

      vi.mocked(prisma.message.updateMany).mockResolvedValue({ count: 2 } as any);
      vi.mocked(prisma.conversation.updateMany).mockResolvedValue({ count: 1 } as any);
      vi.mocked(prisma.message.groupBy).mockResolvedValue([
        { conversation_id: convId, _count: { id: 3 } },
      ] as any);
      vi.mocked(prisma.message.count).mockResolvedValue(5 as any);
      vi.mocked(prisma.conversation.count).mockResolvedValue(1 as any);

      // mark read via direct service
      await expect(messageReadStatusService.markConversationMessagesAsRead(convId, TENANT)).resolves.not.toThrow();

      // batch unread via facade
      const counts = await messageService.getUnreadCountsBatch([convId], TENANT);
      expect(counts.get(convId)).toBe(3);

      // total unread via facade
      const total = await messageService.getTotalUnreadCount(TENANT);
      expect(total).toBe(6);

      // mark all as read via facade
      const allRead = await messageService.markAllMessagesAsRead(TENANT);
      expect(allRead).toBe(2);
    });
  });
});
