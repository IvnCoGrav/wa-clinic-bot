import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { commandService } from '../../src/services/command.service';
import { conversationService } from '../../src/services/conversation.service';
import { getConversationRepository } from '../../src/repositories/conversation.repository';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * F8 / M01-15 — konfirmasi /reset disimpan sebagai state percakapan
 * (`session_data.reset_pending_at`), bukan variabel proses. Dengan begitu:
 * - "YA" hanya dieksekusi bila ada prompt /reset yang belum kedaluwarsa;
 * - app/worker/replika melihat status yang sama;
 * - pesan lain membatalkan pending dan tetap diproses normal.
 */

describe('F8 — /reset pending persisten per percakapan', () => {
  const tenantId = DEFAULT_TENANT_ID;
  const customer = {
    id: 'cust-f8-reset',
    tenant_id: tenantId,
    phone: '628111000999',
    name: 'Bunda Uji',
    status: 'active',
  };
  let conversation: any;

  const run = (text: string, conv: any = conversation) =>
    commandService.tryHandle(
      { customer, conversation: conv, incomingMessage: { text: { body: text } } } as any,
      tenantId
    );

  beforeEach(async () => {
    vi.restoreAllMocks();
    (prisma.customer as any).update = vi.fn().mockResolvedValue({});
    (prisma.reservation as any).findMany = vi.fn().mockResolvedValue([]);
    (prisma.medicalFaqStaging as any).deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    (prisma.generalFaqStaging as any).deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('/reset menyimpan pending ke session_data (bukan memori proses)', async () => {
    const res = await run('/reset');
    expect(res?.replyText).toMatch(/YA/);

    // Baca ulang dari repository (simulasi proses lain / setelah restart).
    const fresh = await conversationService.getConversationById(conversation.id, tenantId);
    expect(fresh?.session_data?.reset_pending_at).toBeTruthy();
    expect(Number.isNaN(Date.parse(fresh.session_data.reset_pending_at))).toBe(false);
  });

  it('YA dengan pending aktif (dibaca dari state persisten) → arsip customer', async () => {
    await run('/reset');
    const fresh = await conversationService.getConversationById(conversation.id, tenantId);

    const res = await run('ya', fresh);

    expect(res).not.toBeNull();
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deleted_at: expect.any(Date) }) })
    );
  });

  it('YA tanpa pending /reset → TIDAK mengarsipkan apa pun', async () => {
    const res = await run('ya');

    expect(res).toBeNull();
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('pending kedaluwarsa (>5 menit) → YA tidak dieksekusi dan penanda dibersihkan', async () => {
    const repo = getConversationRepository();
    await repo.updateState(
      conversation.id,
      { sessionData: { reset_pending_at: new Date(Date.now() - 6 * 60 * 1000).toISOString() } },
      tenantId
    );
    const fresh = await conversationService.getConversationById(conversation.id, tenantId);

    const res = await run('ya', fresh);

    expect(res).toBeNull();
    expect(prisma.customer.update).not.toHaveBeenCalled();
    const after = await conversationService.getConversationById(conversation.id, tenantId);
    expect(after?.session_data?.reset_pending_at).toBeUndefined();
  });

  it('pesan lain saat pending → membatalkan pending, lalu diproses sebagai pesan biasa', async () => {
    await run('/reset');
    const fresh = await conversationService.getConversationById(conversation.id, tenantId);

    const res = await run('Halo min mau tanya jadwal', fresh);

    expect(res).toBeNull();
    expect(prisma.customer.update).not.toHaveBeenCalled();
    const after = await conversationService.getConversationById(conversation.id, tenantId);
    expect(after?.session_data?.reset_pending_at).toBeUndefined();
  });

  it('pending milik percakapan lain tidak memengaruhi customer ini', async () => {
    const other = await conversationService.getOrCreateConversation('cust-f8-other', tenantId);
    await commandService.tryHandle(
      {
        customer: { ...customer, id: 'cust-f8-other' },
        conversation: other,
        incomingMessage: { text: { body: '/reset' } },
      } as any,
      tenantId
    );

    const res = await run('ya');

    expect(res).toBeNull();
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
});
