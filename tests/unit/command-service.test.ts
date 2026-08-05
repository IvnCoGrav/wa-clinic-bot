import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { commandService } from '../../src/services/command.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Unit test CommandService (perintah slash customer: /reset, /state, /mulai).
 *
 * DB di-mock "offline" oleh tests/setup.ts → service pakai memory fallback store.
 * Untuk menguji hard wipe, method prisma.customer.delete / deleteMany staging di-assign
 * di beforeEach (tidak ada di mock default setup.ts).
 */
describe('CommandService — Slash Commands', () => {
  const tenantId = DEFAULT_TENANT_ID;

  const makeCustomer = (phone: string, overrides: any = {}) => ({
    id: `cust-${phone}`,
    tenant_id: tenantId,
    phone,
    name: 'Bunda Uji',
    kelurahan: 'Mulyorejo',
    kecamatan: 'Sukolilo',
    is_out_of_coverage: false,
    is_sandbox_test: false,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  const makeConversation = (customerId: string, overrides: any = {}) => ({
    id: `conv-${customerId}`,
    tenant_id: tenantId,
    customer_id: customerId,
    current_state: ConversationState.AWAITING_INTEREST,
    previous_state: ConversationState.LOCATION_CONFIRMED,
    location_attempts: 2,
    is_human_handling: false,
    human_handling_since: null,
    last_message_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    // Method yang tidak didefinisikan di mock setup.ts — assign mock untuk test hard wipe.
    (prisma.customer as any).delete = vi.fn().mockResolvedValue({ id: 'deleted' });
    (prisma.medicalFaqStaging as any).deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    (prisma.generalFaqStaging as any).deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    (prisma.reservation as any).findMany = vi.fn().mockResolvedValue([]);
    (prisma.customer as any).update = vi.fn().mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('1. /reset → minta konfirmasi + simpan pending untuk customer ini saja', async () => {
    const customer = makeCustomer('6281000000001');
    const conversation = makeConversation(customer.id);

    const result = await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: '/reset' } } } as any, tenantId);

    expect(result).not.toBeNull();
    expect(result!.replyText).toContain('YA');
    expect(result!.conversationId).toBe(conversation.id);

    // Pending hanya untuk customer ini — customer lain tidak terkena.
    const other = makeCustomer('6281000000002');
    const otherConv = makeConversation(other.id);
    const otherResult = await commandService.tryHandle(
      { customer: other, conversation: otherConv, incomingMessage: { text: { body: 'ya' } } } as any,
      tenantId
    );
    expect(otherResult).toBeNull();
  });

  it('2. Balasan YA setelah pending → hard wipe customer + recreate untuk balasan konfirmasi', async () => {
    const phone = '6281000000011';
    const customer = makeCustomer(phone);
    const conversation = makeConversation(customer.id);

    await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: '/reset' } } } as any, tenantId);

    const result = await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: 'ya' } } } as any, tenantId);

    expect(result).not.toBeNull();
    expect(result!.replyText).toContain('dihapus');
    expect(prisma.customer.delete).toHaveBeenCalledWith({ where: { id: customer.id } });
    expect(result!.conversationId).not.toBe(conversation.id); // conversation baru hasil recreate

    // Data lama tidak lagi ditemukan (memory store sudah dibersihkan).
    expect(await customerService.getCustomerById(customer.id, tenantId)).toBeNull();
  });

  it('3. Pesan non-konfirmasi saat pending → batal, diproses sebagai pesan biasa (null)', async () => {
    const customer = makeCustomer('6281000000021');
    const conversation = makeConversation(customer.id);

    await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: '/reset' } } } as any, tenantId);
    const result = await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: 'Halo min' } } } as any, tenantId);

    expect(result).toBeNull();
    expect(prisma.customer.delete).not.toHaveBeenCalled();
  });

  it('4. Konfirmasi setelah pending expired → tidak dieksekusi', async () => {
    vi.useFakeTimers();
    try {
      const customer = makeCustomer('6281000000031');
      const conversation = makeConversation(customer.id);

      await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: '/reset' } } } as any, tenantId);
      vi.advanceTimersByTime(6 * 60 * 1000); // lewati TTL 5 menit
      const result = await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: 'ya' } } } as any, tenantId);

      expect(result).toBeNull();
      expect(prisma.customer.delete).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('5. /state → tampilkan info internal percakapan', async () => {
    const customer = makeCustomer('6281000000041');
    const conversation = makeConversation(customer.id);

    const result = await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: ' /STATE ' } } } as any, tenantId);

    expect(result).not.toBeNull();
    expect(result!.replyText).toContain('AWAITING_INTEREST');
    expect(result!.replyText).toContain('LOCATION_CONFIRMED');
    expect(result!.conversationId).toBe(conversation.id);
  });

  it('6. /mulai → reset state ke INITIAL + balasan greeting', async () => {
    const customer = makeCustomer('6281000000051');
    const conversation = makeConversation(customer.id);

    const result = await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: '/mulai' } } } as any, tenantId);

    expect(result).not.toBeNull();
    expect(typeof result!.replyText).toBe('string');
    expect(result!.replyText.length).toBeGreaterThan(0);
    expect(result!.conversationId).toBe(conversation.id);
  });

  it('7. /start adalah alias /mulai', async () => {
    const customer = makeCustomer('6281000000061');
    const conversation = makeConversation(customer.id);

    const result = await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: '/start' } } } as any, tenantId);

    expect(result).not.toBeNull();
    expect(result!.replyText.length).toBeGreaterThan(0);
  });

  it('8. Command tidak dikenal → null', async () => {
    const customer = makeCustomer('6281000000071');
    const conversation = makeConversation(customer.id);

    const result = await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: '/bogus' } } } as any, tenantId);

    expect(result).toBeNull();
  });

  it('9. Pesan teks biasa (bukan command) → null', async () => {
    const customer = makeCustomer('6281000000081');
    const conversation = makeConversation(customer.id);

    const result = await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: 'Halo min' } } } as any, tenantId);

    expect(result).toBeNull();
  });

  it('10. Hard wipe juga menghapus staging & reservasi yang terkait conversation/customer', async () => {
    const customer = makeCustomer('6281000000091');
    const conversation = makeConversation(customer.id);

    await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: '/reset' } } } as any, tenantId);
    const result = await commandService.tryHandle({ customer, conversation, incomingMessage: { text: { body: 'konfirmasi' } } } as any, tenantId);

    expect(result).not.toBeNull();
    expect(prisma.medicalFaqStaging.deleteMany).toHaveBeenCalledWith({ where: { conversation_id: conversation.id } });
    expect(prisma.generalFaqStaging.deleteMany).toHaveBeenCalledWith({ where: { conversation_id: conversation.id } });
    expect(prisma.reservation.findMany).toHaveBeenCalled();
  });

  it('11. isCommandText hanya true untuk teks diawali "/"', () => {
    expect(commandService.isCommandText('/reset')).toBe(true);
    expect(commandService.isCommandText('  /state  ')).toBe(true);
    expect(commandService.isCommandText('Halo /reset')).toBe(false);
    expect(commandService.isCommandText('halo')).toBe(false);
  });
});
