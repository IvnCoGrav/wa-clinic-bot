import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { stateMachine } from '../../src/state-machine/machine';
import { typingService } from '../../src/services/typing.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Test gate command di state machine: pesan slash (mis. /reset) dicegat di awal
 * processMessage → dikirim balasan konfirmasi, TIDAK lanjut ke state handler/LLM.
 */
describe('State Machine — Command Gate (/reset, /state, /mulai)', () => {
  const tenantId = DEFAULT_TENANT_ID;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.LLM_API_KEY = '';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    process.env.ORS_API_KEY = '';
    process.env.AI_MODEL_ROUTER = '';
    (prisma.customer as any).delete = vi.fn().mockResolvedValue({ id: 'deleted' });
    (prisma.medicalFaqStaging as any).deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    (prisma.generalFaqStaging as any).deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    (prisma.reservation as any).findMany = vi.fn().mockResolvedValue([]);
    // Fix: prisma.conversation.update must return a thenable so .catch() at machine.ts:283 works
    (prisma.conversation as any).update = vi.fn().mockImplementation(() => {
      const p = Promise.resolve({} as any);
      (p as any).catch = () => p;
      return p;
    });
    vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function setupCustomer(phone: string) {
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Uji', tenantId);
    const conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);
    return { customer, conversation };
  }

  it('1. Pesan /reset dicegat di machine → balasan konfirmasi & nextState INITIAL', async () => {
    const phone = `62877${Date.now()}`;
    const { customer, conversation } = await setupCustomer(phone);

    const result = await stateMachine.processMessage({
      tenantId,
      customer,
      conversation,
      incomingMessage: {
        id: `msg_reset_${Date.now()}`,
        from: phone,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: '/reset' },
      },
    });

    expect(result.nextState).toBe(ConversationState.INITIAL);
    expect(result.shouldSendReply).toBe(false); // reply sudah dikirim via typing sim
    expect(typingService.simulateHumanReply).toHaveBeenCalledWith(
      expect.objectContaining({ replyText: expect.stringContaining('YA') })
    );
  });

  it('2. Konfirmasi "ya" → hard wipe dijalankan (prisma.customer.delete dipanggil)', async () => {
    const phone = `62888${Date.now()}`;
    const { customer, conversation } = await setupCustomer(phone);

    await stateMachine.processMessage({
      tenantId,
      customer,
      conversation,
      incomingMessage: {
        id: `msg_reset_${Date.now()}_1`,
        from: phone,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: '/reset' },
      },
    });

    // Refresh snapshot (objek yang sama dipakai; delete memanggil id customer)
    await stateMachine.processMessage({
      tenantId,
      customer,
      conversation,
      incomingMessage: {
        id: `msg_reset_${Date.now()}_2`,
        from: phone,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'ya' },
      },
    });

    expect(prisma.customer.delete).toHaveBeenCalledWith({ where: { id: customer.id } });
  });
});
