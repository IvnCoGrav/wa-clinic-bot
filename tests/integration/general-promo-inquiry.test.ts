import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { ConversationState } from '@prisma/client';
import { TypingService } from '../../src/services/typing.service';
import { MockWAHAClient } from '../../src/cli/mock-waha-client';

describe('General Promo Inquiry & Anaphora Memory Safety', () => {
  let machine: ConversationStateMachine;
  let mockWaha: MockWAHAClient;

  beforeEach(() => {
    mockWaha = new MockWAHAClient();
    const typingService = new TypingService(mockWaha);
    typingService.setSpeedFactor(100000);
    machine = new ConversationStateMachine(typingService);
  });

  it('harus menjawab konfirmasi umum saat customer bertanya "Untuk promonya apa masih berlangsung ya?" di sesi baru', async () => {
    const customer: any = {
      id: 'cust_promo_test_1',
      phone: '628123456789',
      status: 'active',
      tenant_id: 'default-tenant',
    };

    const conversation: any = {
      id: 'conv_promo_test_1',
      current_state: ConversationState.INITIAL,
      is_human_handling: false,
    };

    const incomingMessage: any = {
      id: 'msg_promo_1',
      type: 'text',
      text: { body: 'Untuk promonya apa masih berlangsung ya?' },
      from: '628123456789',
      chatId: '628123456789@c.us',
    };

    const ctx: any = {
      customer,
      conversation,
      incomingMessage,
      tenantId: 'default-tenant',
      history: [],
    };

    const result = await machine.processMessage(ctx);

    expect(result.shouldSendReply).toBe(true);
    expect(result.replyText).toBeDefined();
    // Pastikan konfirmasi promo dijawab ramah dan TIDAK mengunci ke treatment acak (misal Custom Kids Bubble Spa)
    expect(result.replyText).toMatch(/Masih berlangsung Bunda/i);
    expect(result.replyText).not.toMatch(/Custom Kids Bubble Spa/i);
  });
});
