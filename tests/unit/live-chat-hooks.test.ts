import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Direction } from '@prisma/client';
import { messageService } from '../../src/services/message.service';
import { conversationService } from '../../src/services/conversation.service';
import { getLiveChatHub } from '../../src/services/live-chat-hub.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Live Chat Hooks (message.created & conversation.updated)', () => {
  let publishSpy: any;

  beforeEach(() => {
    publishSpy = vi.spyOn(getLiveChatHub(), 'publish').mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Restore hanya spy hub; JANGAN vi.restoreAllMocks() karena me-reset mock Prisma global (setup.ts)
    publishSpy.mockRestore();
  });

  it('logMessage publishes message.created with senderType ADMIN & senderName', async () => {
    await messageService.logMessage({
      conversationId: 'conv_admin_1',
      direction: Direction.OUTBOUND,
      content: 'Halo Bunda, ini balasan admin',
      tenantId: DEFAULT_TENANT_ID,
      senderType: 'ADMIN',
      senderName: 'Admin Klinik',
    });

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const event = publishSpy.mock.calls[0][0];
    expect(event.type).toBe('message.created');
    expect(event.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(event.payload.senderType).toBe('ADMIN');
    expect(event.payload.senderName).toBe('Admin Klinik');
    expect(event.payload.direction).toBe(Direction.OUTBOUND);
    expect(event.payload.conversationId).toBe('conv_admin_1');
  });

  it('logMessage defaults senderType to BOT for outbound & CUSTOMER for inbound', async () => {
    await messageService.logMessage({
      conversationId: 'conv_defaults_1',
      direction: Direction.OUTBOUND,
      content: 'Balasan bot',
      tenantId: DEFAULT_TENANT_ID,
    });
    await messageService.logMessage({
      conversationId: 'conv_defaults_1',
      direction: Direction.INBOUND,
      content: 'Pertanyaan customer',
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(publishSpy).toHaveBeenCalledTimes(2);
    const events = publishSpy.mock.calls.map((c: any) => c[0]);
    expect(events[0].payload.senderType).toBe('BOT');
    expect(events[1].payload.senderType).toBe('CUSTOMER');
  });

  it('updateConversationState publishes conversation.updated with state snapshot', async () => {
    const conv = await conversationService.getOrCreateConversation('cust_hook_state', DEFAULT_TENANT_ID);
    publishSpy.mockClear();

    await conversationService.updateConversationState(
      conv.id,
      { isHumanHandling: true, humanHandlingSince: new Date() },
      DEFAULT_TENANT_ID
    );

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const event = publishSpy.mock.calls[0][0];
    expect(event.type).toBe('conversation.updated');
    expect(event.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(event.payload.conversationId).toBe(conv.id);
    expect(event.payload.customerId).toBe('cust_hook_state');
    expect(event.payload.isHumanHandling).toBe(true);
    expect(event.payload.humanHandlingSince).toBeTruthy();
  });

  it('resetHumanHandlingTimer slides humanHandlingSince & publishes conversation.updated', async () => {
    const conv = await conversationService.getOrCreateConversation('cust_hook_timer', DEFAULT_TENANT_ID);
    const oldSince = new Date(Date.now() - 1000 * 60 * 60 * 5);
    await conversationService.updateConversationState(
      conv.id,
      { isHumanHandling: true, humanHandlingSince: oldSince },
      DEFAULT_TENANT_ID
    );
    publishSpy.mockClear();

    const updated = await conversationService.resetHumanHandlingTimer(conv.id, DEFAULT_TENANT_ID);

    expect(new Date(updated.human_handling_since).getTime()).toBeGreaterThan(oldSince.getTime());
    expect(updated.is_human_handling).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][0].type).toBe('conversation.updated');
  });

  it('escalateToHumanHandling publishes conversation.updated with HUMAN_HANDLING state', async () => {
    const conv = await conversationService.getOrCreateConversation('cust_hook_esc', DEFAULT_TENANT_ID);
    publishSpy.mockClear();

    await conversationService.escalateToHumanHandling(conv, '628111222333', 'complex query', DEFAULT_TENANT_ID, 'complex_query');

    const event = publishSpy.mock.calls[publishSpy.mock.calls.length - 1][0];
    expect(event.type).toBe('conversation.updated');
    expect(event.payload.conversationId).toBe(conv.id);
    expect(event.payload.isHumanHandling).toBe(true);
    expect(event.payload.escalationReason).toBe('complex_query');
  });
});
