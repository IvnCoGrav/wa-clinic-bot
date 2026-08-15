import { describe, it, expect } from 'vitest';
import { isMultiChildTransportQuestion } from '../../src/state-machine/utils/transport-policy-checker';
import { isAskPrice } from '../../src/services/price-answer.service';
import { handleInterestState } from '../../src/state-machine/handlers/interest';
import { ConversationState } from '@prisma/client';

describe('Multi-Child Transport Policy Inquiry ("Untuk 2 anak transportnya 1 kan")', () => {
  it('isMultiChildTransportQuestion detects various multi-child/multi-treatment transport questions', () => {
    const testCases = [
      'Untuk 2 anak transportnya 1 kan',
      'kalo 2 anak ongkirnya bayar 1 atau 2 kali?',
      'kalau 2 anak transportnya berapa kali bayar?',
      'ongkirnya 1 kali kan kalau 2 anak?',
      'transportnya dihitung per anak atau per kedatangan?',
      'kalau ambil 2 treatment transportnya bayar 1x kan?',
      'bunda dan anak ongkirnya 1 kan?',
      'kalo untuk 2 bayi ongkirnya gimana min?',
    ];

    testCases.forEach((tc) => {
      expect(isMultiChildTransportQuestion(tc)).toBe(true);
    });
  });

  it('isAskPrice does NOT hijack multi-child transport questions as treatment pricing', () => {
    const isPrice = isAskPrice('Untuk 2 anak transportnya 1 kan', ['ask_price']);
    expect(isPrice).toBe(false);
  });

  it('handleInterestState replies confirming transport fee is charged 1x per visit', async () => {
    const mockCtx: any = {
      incomingMessage: {
        id: 'msg_1',
        from: '628123456789',
        type: 'text',
        text: { body: 'Untuk 2 anak transportnya 1 kan' },
      },
      customer: {
        id: 'cust_1',
        phone: '628123456789',
        tenant_id: 'default-tenant',
        kelurahan: 'Waru',
        kecamatan: 'Waru',
        kota: 'Kabupaten Sidoarjo',
        lat: -7.34886,
        lng: 112.751677,
      },
      conversation: {
        id: 'conv_1',
        state: ConversationState.AWAITING_INTEREST,
        last_discussed_treatment: 'Pijat Kids Ceria',
      },
      nluResult: {
        intents: ['ask_price', 'faq_question'],
        confidence: 0.95,
        isFallback: false,
      },
    };

    const result = await handleInterestState(mockCtx);

    expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(result.shouldSendReply).toBe(true);
    expect(result.replyText).toContain('1 kali');
    expect(result.replyText).toContain('per kedatangan');
    // Must NOT reply with treatment price
    expect(result.replyText).not.toContain('Rp 85.000');
    expect(result.replyText).not.toContain('Pijat Kids Ceria-nya');
  });
});
