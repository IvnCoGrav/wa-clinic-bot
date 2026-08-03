import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { buildApp } from '../../src/app';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { IdleGreetingConfigService } from '../../src/config/idle-greeting.config';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

// Mock LLM services secara global untuk mencegah panggilan API nyata / timeout.
vi.mock('../../src/integrations/llm/intent', () => {
  return {
    llmIntentService: {
      detectIntent: async () => ({ intent: 'other' }),
    },
  };
});

vi.mock('../../src/integrations/llm/generator', () => {
  return {
    llmResponseGenerator: {
      generateFaqResponse: async () => 'Mock FAQ response',
    },
  };
});

const app = buildApp();

describe('Warm Reopening Greeting — gate handler (INITIAL & AWAITING_INTEREST)', () => {
  const testStateMachine = new ConversationStateMachine();

  beforeEach(() => {
    vi.restoreAllMocks();
    IdleGreetingConfigService.clearCache();
    delete process.env.IDLE_GREETING_ENABLED;
    delete process.env.IDLE_GREETING_MIN_HOURS;
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
  });

  function ctxFor(phone: string, conversation: any, text: string) {
    return {
      tenantId: DEFAULT_TENANT_ID,
      customer: conversation._cust,
      conversation,
      incomingMessage: {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: text },
      },
    };
  }

  async function makeConversation(state: ConversationState, idleHours: number) {
    const phone = `628888${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    const conv = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    conv._cust = cust;
    conv.current_state = state;
    conv.last_message_at = new Date(Date.now() - idleHours * 60 * 60 * 1000);
    return conv;
  }

  it('INITIAL: sapaan murni + idle 48 jam → warm greeting + AWAITING_INTEREST', async () => {
    const conv = await makeConversation(ConversationState.INITIAL, 48);
    const res = await testStateMachine.processMessage(ctxFor(conv._cust.phone, conv, 'halo'));
    expect(res.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(res.replyText).toContain('Halo Bunda');
    expect(res.replyText).not.toContain('tertarik untuk lanjut');
    expect(res.replyText).not.toContain('rumahnya dimana');
  });

  it('AWAITING_INTEREST: sapaan murni + idle 48 jam → warm greeting (bukan pitch reservasi)', async () => {
    const conv = await makeConversation(ConversationState.AWAITING_INTEREST, 48);
    const res = await testStateMachine.processMessage(ctxFor(conv._cust.phone, conv, 'hai bubid'));
    expect(res.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(res.replyText).not.toContain('tertarik untuk lanjut mengisi list reservasi');
  });

  it('AWAITING_INTEREST: sapaan + intent spesifik (harga) → jalur FAQ normal, BUKAN warm greeting', async () => {
    const conv = await makeConversation(ConversationState.AWAITING_INTEREST, 48);
    const res = await testStateMachine.processMessage(ctxFor(conv._cust.phone, conv, 'halo berapa harga pijat bayi'));
    expect(res.replyText).not.toContain('Ada yang bisa saya bantu hari ini');
  });

  it('AWAITING_INTEREST: idle pendek (1 jam) → pitch reservasi tetap (fitur tidak aktif)', async () => {
    const conv = await makeConversation(ConversationState.AWAITING_INTEREST, 1);
    const res = await testStateMachine.processMessage(ctxFor(conv._cust.phone, conv, 'halo'));
    expect(res.replyText).toContain('tertarik untuk lanjut mengisi list reservasi');
  });

  it('IDLE_GREETING_ENABLED=false → warm greeting tidak aktif (fallback ke greeting biasa)', async () => {
    process.env.IDLE_GREETING_ENABLED = 'false';
    const conv = await makeConversation(ConversationState.AWAITING_INTEREST, 48);
    const res = await testStateMachine.processMessage(ctxFor(conv._cust.phone, conv, 'halo'));
    // Fitur mati → bot tidak mengirim warm reopening greeting.
    expect(res.replyText).not.toContain('Ada yang bisa saya bantu hari ini');
    // Idle 48 jam > idle reset 24 jam → diarahkan ke INITIAL & greeting standar.
    expect(res.replyText).toContain('Halo Bunda');
  });
});
