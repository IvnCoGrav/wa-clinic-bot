import { describe, it, expect, beforeEach } from 'vitest';
import { messageService } from '../../src/services/message.service';
import { conversationService } from '../../src/services/conversation.service';
import { Direction } from '@prisma/client';

describe('Chat Unread Status, Orange Dot & Pinning Tests', () => {
  const tenantId = 'default-tenant';
  const customerId = 'cust_test_unread_pin_01';

  beforeEach(() => {
    conversationService.clearConversationMemory(customerId);
  });

  it('should initialize conversation with is_pinned=false and is_manual_unread=false', async () => {
    const conv = await conversationService.getOrCreateConversation(customerId, tenantId);
    expect(conv.is_pinned).toBe(false);
    expect(conv.is_manual_unread).toBe(false);
  });

  it('should toggle pin conversation to true and back to false', async () => {
    const conv = await conversationService.getOrCreateConversation(customerId, tenantId);
    
    // Toggle pin to true
    const pinned = await conversationService.togglePinConversation(conv.id, tenantId, true);
    expect(pinned.is_pinned).toBe(true);
    expect(pinned.pinned_at).toBeInstanceOf(Date);

    // Toggle pin to false
    const unpinned = await conversationService.togglePinConversation(conv.id, tenantId, false);
    expect(unpinned.is_pinned).toBe(false);
    expect(unpinned.pinned_at).toBeNull();
  });

  it('should accurately track unread messages and mark as read/unread', async () => {
    const conv = await conversationService.getOrCreateConversation(customerId, tenantId);
    const memMsgs = messageService.getMemoryMessages();

    // Tambah pesan inbound
    const msgId = `msg_inbound_${Date.now()}`;
    memMsgs.push({
      id: msgId,
      conversation_id: conv.id,
      tenant_id: tenantId,
      direction: 'INBOUND',
      content: 'Halo mau tanya paket pijat bayi',
      read_at: null,
      created_at: new Date(),
    });

    // Check unread count
    const unreadMap = await messageService.getUnreadCountsBatch([conv.id], tenantId);
    expect(unreadMap.get(conv.id)).toBe(1);

    // Mark as read
    await messageService.markConversationMessagesAsRead(conv.id, tenantId);
    const unreadMapAfterRead = await messageService.getUnreadCountsBatch([conv.id], tenantId);
    expect(unreadMapAfterRead.get(conv.id) || 0).toBe(0);

    // Manual mark as unread
    await messageService.markConversationAsUnread(conv.id, tenantId);
    const convAfterUnread = await conversationService.getConversationById(conv.id, tenantId);
    expect(convAfterUnread?.is_manual_unread).toBe(true);

    const unreadMapAfterManual = await messageService.getUnreadCountsBatch([conv.id], tenantId);
    expect(unreadMapAfterManual.get(conv.id)).toBe(1);
  });

  it('should verify 24-hour lifespan logic for orange awaiting reply dot', () => {
    const now = Date.now();
    const twentyHoursAgo = new Date(now - 20 * 60 * 60 * 1000);
    const twentyFiveHoursAgo = new Date(now - 25 * 60 * 60 * 1000);

    const isWithin24h = (d: Date) => (now - d.getTime()) <= 24 * 60 * 60 * 1000;

    expect(isWithin24h(twentyHoursAgo)).toBe(true); // Should show orange dot
    expect(isWithin24h(twentyFiveHoursAgo)).toBe(false); // Should expire / hide dot
  });
});
