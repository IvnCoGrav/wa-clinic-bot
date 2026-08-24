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

  it('AiResponseVerifierService mencatat audit log dan llm execution record pada draf non-bypass', async () => {
    process.env.LLM_API_KEY = 'test-key-for-verifier';
    const modelFallback = await import('../../src/integrations/llm/model-fallback');
    const spyFallback = vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                is_valid: true,
                violation_reasons: [],
                corrected_reply: null,
                confidence_score: 0.98,
                reasoning: 'Draf aman dan sesuai.',
              }),
            },
          },
        ],
        usage: { prompt_tokens: 450, completion_tokens: 60 },
      } as any,
      model: 'MiniMax-M2.7-highspeed',
      baseUrl: 'https://ai.sumopod.com/v1',
    });

    const res = await AiResponseVerifierService.verifyAndCorrect({
      customerPhone: '628123456789',
      customerMessage: 'Anak saya susah tidur',
      draftReply: 'Halo Bunda, kami sarankan Pijat Ceria ya bund.',
      groundTruth: {
        customerAgeMonths: 12,
      },
    });

    expect(res.wasCorrected).toBe(false);
    expect(res.finalReply).toContain('Pijat Ceria');

    const { getLlmExecutionLogs } = await import('../../src/utils/llm-execution-logger');
    const logs = getLlmExecutionLogs(10, 'AI_VERIFIER');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].flowType).toBe('AI_VERIFIER');
    expect(logs[0].status).toBe('SUCCESS');

    spyFallback.mockRestore();
  });
});