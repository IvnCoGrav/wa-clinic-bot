import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Direction } from '@prisma/client';
import { liveChatService } from '../../src/services/live-chat.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { messageService } from '../../src/services/message.service';
import { createTestGateway, resetGateway } from '../../src/integrations/whatsapp/factory';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

function makeFakeGateway(provider: 'WAHA' | 'WABA' = 'WAHA') {
  return {
    providerType: provider,
    sendTextMessage: vi.fn().mockResolvedValue({ success: true, messageId: `waid_${Math.random().toString(36).slice(2)}`, provider }),
    sendTemplateMessage: vi.fn().mockResolvedValue({ success: true, provider }),
    sendImageMessage: vi.fn().mockResolvedValue({ success: true, provider }),
    sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
    markAsRead: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('LiveChatService — monitor & balas admin', () => {
  beforeEach(() => {
    // CATATAN: JANGAN pakai vi.restoreAllMocks() — akan me-reset mock Prisma global (setup.ts)
    resetGateway();
  });

  it('getConversationList offline: menampilkan percakapan + preview pesan dengan sender_type', async () => {
    const phone = `628100${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Test', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: Direction.INBOUND,
      content: 'Halo',
    });
    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: Direction.OUTBOUND,
      content: 'Balasan admin',
      senderType: 'ADMIN',
      senderName: 'Admin Klinik',
    });

    const list = await liveChatService.getConversationList(DEFAULT_TENANT_ID);
    const item = list.find((c) => c.conversationId === conversation.id);
    expect(item).toBeTruthy();
    expect(item!.customerPhone).toBe(phone);
    expect(item!.lastMessages.length).toBe(2);
    expect(item!.lastMessages[1].sender_type).toBe('ADMIN');
    expect(item!.lastMessages[1].sender_name).toBe('Admin Klinik');
  });

  it('sendAdminReply: kirim via gateway + auto-escalation ke HUMAN_HANDLING + log sender ADMIN', async () => {
    const fake = makeFakeGateway('WAHA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const phone = `628200${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Auto', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: 'Baik Bunda, kami proses ya',
      tenantId: DEFAULT_TENANT_ID,
      adminName: 'Admin Klinik',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(fake.sendTextMessage).toHaveBeenCalledWith(phone, 'Baik Bunda, kami proses ya');

    const updated = await conversationService.getConversationById(conversation.id, DEFAULT_TENANT_ID);
    expect(updated.is_human_handling).toBe(true);
    expect(updated.escalation_reason).toBe('manual_reply');

    const messages = await liveChatService.getConversationMessages(conversation.id, DEFAULT_TENANT_ID);
    expect(messages.some((m) => m.sender_type === 'ADMIN' && m.content === 'Baik Bunda, kami proses ya')).toBe(true);
  });

  it('sendAdminReply: text kosong → EMPTY_REPLY tanpa memanggil gateway', async () => {
    const fake = makeFakeGateway('WAHA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const customer = await customerService.getOrCreateCustomer(`628300${Date.now()}`, 'Bunda Empty', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: '   ',
      tenantId: DEFAULT_TENANT_ID,
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EMPTY_REPLY');
    expect(fake.sendTextMessage).not.toHaveBeenCalled();
  });

  it('sendAdminReply WABA: di luar 24h window → WABA_OUTSIDE_WINDOW; dengan acknowledge → terkirim', async () => {
    const fake = makeFakeGateway('WABA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const customer = await customerService.getOrCreateCustomer(`628400${Date.now()}`, 'Bunda Waba', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const spied = vi
      .spyOn(liveChatService as any, 'getLastInboundAt')
      .mockResolvedValue(new Date(Date.now() - 25 * 60 * 60 * 1000));

    const blocked = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: 'Test',
      tenantId: DEFAULT_TENANT_ID,
    });
    expect(blocked.success).toBe(false);
    expect(blocked.error?.code).toBe('WABA_OUTSIDE_WINDOW');
    expect(fake.sendTextMessage).not.toHaveBeenCalled();

    const ack = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: 'Test',
      tenantId: DEFAULT_TENANT_ID,
      acknowledgeOutsideWindow: true,
    });
    expect(ack.success).toBe(true);
    expect(fake.sendTextMessage).toHaveBeenCalled();

    spied.mockRestore();
  });

  it('sendAdminReply: conversation tidak ditemukan → CONVERSATION_NOT_FOUND', async () => {
    const result = await liveChatService.sendAdminReply({
      conversationId: 'conv_tidak_ada_xyz',
      text: 'Halo',
      tenantId: DEFAULT_TENANT_ID,
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CONVERSATION_NOT_FOUND');
  });
});
