import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { liveChatService } from '../../src/services/live-chat.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { createTestGateway, resetGateway } from '../../src/integrations/whatsapp/factory';
import { auditService } from '../../src/services/audit.service';

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

describe('LiveChatService — Unregistered Visit Dispatch Warning (MT-2.1)', () => {
  const tenantId = DEFAULT_TENANT_ID;
  let convId: string;
  let custId: string;
  let fakeGateway: any;

  beforeEach(async () => {
    resetGateway();
    fakeGateway = makeFakeGateway('WAHA');
    createTestGateway(fakeGateway, tenantId);

    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue({} as any);

    const phone = `628990${Date.now().toString().slice(-7)}`;
    const cust = await customerService.getOrCreateCustomer(
      phone,
      'Bunda Dewi',
      tenantId
    );
    custId = cust.id;
    const conv = await conversationService.getOrCreateConversation(
      custId,
      tenantId
    );
    convId = conv.id;
  });

  it('mengirim pesan media/shareloc tanpa reservasi hari ini → tetap sukses terkirim dan memberi warning NO_ACTIVE_RESERVATION_TODAY', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);

    const result = await liveChatService.sendAdminReply({
      conversationId: convId,
      text: '[LOCATION: Lat -7.267, Lng 112.698] Disini bunda',
      tenantId,
      adminName: 'Bidan Nisa',
    });
    expect(result.success).toBe(true);
    expect(result.warning).toBe('NO_ACTIVE_RESERVATION_TODAY');
    expect(fakeGateway.sendTextMessage).toHaveBeenCalled();
    expect(auditService.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UNREGISTERED_VISIT_DISPATCH_DETECTED',
      })
    );
  });

  it('mengirim pesan teks biasa tanpa media/shareloc → sukses tanpa warning', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);

    const result = await liveChatService.sendAdminReply({
      conversationId: convId,
      text: 'Halo Bunda, ada yang bisa dibantu?',
      tenantId,
      adminName: 'Admin',
    });

    expect(result.success).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(fakeGateway.sendTextMessage).toHaveBeenCalled();
    expect(auditService.logAdminAction).not.toHaveBeenCalled();
  });

  it('mengirim media saat reservasi confirmed hari ini ada di DB → sukses tanpa warning', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue({
      id: 'res-today-1',
      status: 'confirmed',
      booking_date: new Date(),
    } as any);

    const result = await liveChatService.sendAdminReply({
      conversationId: convId,
      text: '[LOCATION: Lat -7.267, Lng 112.698] Sudah sampai ya bun',
      tenantId,
      adminName: 'Bidan Nisa',
    });

    expect(result.success).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(fakeGateway.sendTextMessage).toHaveBeenCalled();
  });
});
