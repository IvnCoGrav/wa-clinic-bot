import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { ConversationState } from '@prisma/client';
import { TypingService } from '../../src/services/typing.service';
import { MockWAHAClient } from '../../src/cli/mock-waha-client';

describe('Age Clarification & Location Anti-Geocode Guard', () => {
  let machine: ConversationStateMachine;
  let mockWaha: MockWAHAClient;

  beforeEach(() => {
    mockWaha = new MockWAHAClient();
    const typingService = new TypingService(mockWaha);
    typingService.setSpeedFactor(100000);
    machine = new ConversationStateMachine(typingService);
  });

  it('harus mengarahkan jawaban usia "3 bulan ka" ke rekomendasi treatment dan TIDAK ke kelurahan Bulang', async () => {
    const customer: any = {
      id: 'cust_age_test_1',
      phone: '628123456789',
      status: 'active',
      tenant_id: 'default-tenant',
    };

    const conversation: any = {
      id: 'conv_age_test_1',
      current_state: ConversationState.AWAITING_LOCATION,
      is_human_handling: false,
    };

    const incomingMessage: any = {
      id: 'msg_age_1',
      type: 'text',
      text: { body: '3 bulan ka' },
      from: '628123456789',
      chatId: '628123456789@c.us',
    };

    const ctx: any = {
      customer,
      conversation,
      incomingMessage,
      tenantId: 'default-tenant',
      history: [
        { role: 'user', content: 'Bayi saya baru di vaksin apakah boleh ya dipijat' },
        { role: 'assistant', content: 'Boleh saja Bun... Kalau boleh tahu usianya berapa bulan Bun? Biar saya bantu rekomendasikan treatment yang paling sesuai untuk si kecil.' },
      ],
    };

    const result = await machine.processMessage(ctx);

    expect(result.shouldSendReply).toBe(true);
    expect(result.replyText).toBeDefined();
    // Pastikan TIDAK ADA penyebutan kelurahan Bulang
    expect(result.replyText).not.toMatch(/kelurahan\s+\*?bulang\*?/i);
    expect(result.replyText).not.toMatch(/apakah yang bunda maksud kelurahan/i);
    // State tetap AWAITING_LOCATION karena customer belum kirim alamat
    expect(result.nextState).toBe(ConversationState.AWAITING_LOCATION);
  });
});
