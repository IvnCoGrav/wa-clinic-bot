import { describe, it, expect, vi, beforeEach } from 'vitest';
import { conversationService } from '../../src/services/conversation.service';
import { messageService } from '../../src/services/message.service';
import { prisma } from '../../src/db/client';

/**
 * Regresi AUDIT #316 FASE 3 (K-03): seluruh mutasi conversation/message WAJIB
 * menyertakan tenant_id di WHERE. Test ini mengunci kontrak tersebut agar
 * IDOR lintas tenant tidak kembali.
 */
describe('Live Chat tenant-scoped writes (FASE 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const tenantRow = { id: 'conv-1', tenant_id: 'tenant-a', is_pinned: false, is_manual_unread: false };

  it('togglePinConversation menulis dengan tenant_id di WHERE', async () => {
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue(tenantRow as any);
    vi.mocked(prisma.conversation.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue({ ...tenantRow, is_pinned: true } as any);

    const updated = await conversationService.togglePinConversation('conv-1', 'tenant-a', true);

    expect(updated?.is_pinned).toBe(true);
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-1', tenant_id: 'tenant-a' } })
    );
  });

  it('ADVERSARIAL: tenant lain tidak bisa mem-pin (updateMany count 0, tidak ada tulis)', async () => {
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ ...tenantRow, tenant_id: 'tenant-b' } as any);
    vi.mocked(prisma.conversation.updateMany).mockResolvedValue({ count: 0 } as any);

    const updated = await conversationService.togglePinConversation('conv-1', 'tenant-a', true);

    expect(updated).toBeNull();
    // WHERE tetap menyertakan tenant pemanggil → baris tenant-b tidak tersentuh.
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-1', tenant_id: 'tenant-a' } })
    );
  });

  it('markConversationMessagesAsRead menulis pesan & conversation dengan tenant_id', async () => {
    vi.mocked(prisma.message.updateMany).mockResolvedValue({ count: 2 } as any);
    vi.mocked(prisma.conversation.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue(tenantRow as any);
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(tenantRow as any);

    await messageService.markConversationMessagesAsRead('conv-1', 'tenant-a');

    expect(prisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ conversation_id: 'conv-1', tenant_id: 'tenant-a' }),
      })
    );
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-1', tenant_id: 'tenant-a' } })
    );
  });

  it('markConversationAsUnread menggunakan tenant-scoped update', async () => {
    vi.mocked(prisma.conversation.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.message.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue(tenantRow as any);
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(tenantRow as any);

    await messageService.markConversationAsUnread('conv-1', 'tenant-a');

    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-1', tenant_id: 'tenant-a' } })
    );
  });
});
