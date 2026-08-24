import { describe, it, expect, vi } from 'vitest';
import { AiResponseVerifierService } from '../../src/services/ai-verifier.service';
import { messageService } from '../../src/services/message.service';

describe('AI Verifier & In-Flight Outbound Unit Tests', () => {
  it('isInFlightBotOutbound mendeteksi pesan bot yang baru saja dikirim', () => {
    const phone = '628123456789';
    const content = 'Halo Bunda, kami rekomendasikan Pijat Kids Ceria ya 😊';
    const tenantId = 'default-tenant';

    messageService.registerInFlightBotOutbound(phone, content, tenantId);

    const isMatched = messageService.isInFlightBotOutbound(phone, content, tenantId);
    expect(isMatched).toBe(true);

    const isDifferentPhone = messageService.isInFlightBotOutbound('628999999999', content, tenantId);
    expect(isDifferentPhone).toBe(false);
  });

  it('AiResponseVerifierService melewati bypass untuk format reservasi baku', async () => {
    const res = await AiResponseVerifierService.verifyAndCorrect({
      customerPhone: '628123456789',
      customerMessage: 'mau booking',
      draftReply: 'list untuk reservasi :\nNama:\nAlamat:\nTanggal:',
      groundTruth: {},
    });

    expect(res.wasCorrected).toBe(false);
    expect(res.finalReply).toContain('list untuk reservasi :');
  });
});