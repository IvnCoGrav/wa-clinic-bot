import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Direction } from '@prisma/client';
import { messageService } from '../../src/services/message.service';
import { followUpService } from '../../src/services/follow-up.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Adversarial integration suite: event hook inbound di messageService.logMessage
 * harus memicu sliding window HANYA untuk pesan masuk riil customer (bukan
 * historical sync, bukan sandbox, bukan outbound bot).
 */
describe('Inbound Chat → Follow-Up Sliding Window Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const flush = () => new Promise((r) => setTimeout(r, 30));

  it('1. inbound riil memicu rescheduleNoPurchaseOnInboundChat (anchored createdAt)', async () => {
    const phone = `62857${Date.now() % 1000000}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Hook Test', DEFAULT_TENANT_ID);
    (customer as any).is_sandbox_test = false;
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const hookSpy = vi
      .spyOn(followUpService, 'rescheduleNoPurchaseOnInboundChat')
      .mockResolvedValue({ rescheduled: 3, cancelled: 0 });

    const createdAt = new Date('2026-09-16T15:00:00.000Z');
    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conv.id,
      direction: Direction.INBOUND,
      content: 'Halo bidan, masih ada slot?',
      createdAt,
    });
    await flush();

    expect(hookSpy).toHaveBeenCalledTimes(1);
    expect(hookSpy).toHaveBeenCalledWith(customer.id, DEFAULT_TENANT_ID, createdAt);
  });

  it('2. pesan HISTORICAL (isHistorical) TIDAK menggeser jadwal', async () => {
    const phone = `62858${Date.now() % 1000000}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Hist Test', DEFAULT_TENANT_ID);
    (customer as any).is_sandbox_test = false;
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const hookSpy = vi.spyOn(followUpService, 'rescheduleNoPurchaseOnInboundChat').mockResolvedValue({
      rescheduled: 0,
      cancelled: 0,
    });

    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conv.id,
      direction: Direction.INBOUND,
      content: 'pesan lama hasil sync riwayat',
      isHistorical: true,
    });
    await flush();

    expect(hookSpy).not.toHaveBeenCalled();
  });

  it('3. outbound bot TIDAK memicu sliding window', async () => {
    const phone = `62859${Date.now() % 1000000}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Out Test', DEFAULT_TENANT_ID);
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const hookSpy = vi.spyOn(followUpService, 'rescheduleNoPurchaseOnInboundChat').mockResolvedValue({
      rescheduled: 0,
      cancelled: 0,
    });

    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conv.id,
      direction: Direction.OUTBOUND,
      content: 'Balasan bot',
      senderType: 'BOT',
    });
    await flush();

    expect(hookSpy).not.toHaveBeenCalled();
  });

  it('4. sandbox test TIDAK memicu sliding window', async () => {
    const phone = `628999${Date.now() % 1000000}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Sandbox Customer', DEFAULT_TENANT_ID);
    (customer as any).is_sandbox_test = true;
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const hookSpy = vi.spyOn(followUpService, 'rescheduleNoPurchaseOnInboundChat').mockResolvedValue({
      rescheduled: 0,
      cancelled: 0,
    });

    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conv.id,
      direction: Direction.INBOUND,
      content: 'pesan QA',
    });
    await flush();

    expect(hookSpy).not.toHaveBeenCalled();
  });

  it('5. hook gagal (DB error) TIDAK membocorkan error ke pemanggil logMessage', async () => {
    const phone = `62856${Date.now() % 1000000}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Fail Test', DEFAULT_TENANT_ID);
    (customer as any).is_sandbox_test = false;
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    vi.spyOn(followUpService, 'rescheduleNoPurchaseOnInboundChat').mockRejectedValue(
      new Error('DB down')
    );
    vi.spyOn(prisma.followUp, 'findMany').mockRejectedValue(new Error('Database offline'));

    await expect(
      messageService.logMessage({
        tenantId: DEFAULT_TENANT_ID,
        conversationId: conv.id,
        direction: Direction.INBOUND,
        content: 'halo',
      })
    ).resolves.toBeTruthy();
    await flush();
  });
});
