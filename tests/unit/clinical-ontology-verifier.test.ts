import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiResponseVerifierService } from '../../src/services/ai-verifier.service';
import * as modelFallback from '../../src/integrations/llm/model-fallback';

describe('Clinical Ontology & AI Verifier QC', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test_key_123';
    process.env.LLM_API_KEY = 'test_key_123';
  });
  it('should guarantee smile emoji is appended if omitted by draft', async () => {
    // Mock callChatCompletionsWithFallback to return valid QC response without emoji
    vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValueOnce({
      model: 'MiniMax-M2.7-highspeed',
      baseUrl: 'https://api.sumopod.com',
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                is_valid: true,
                violation_reasons: [],
                corrected_reply: null,
                confidence_score: 1.0,
                reasoning: 'QC PASSED: Sesuai ground truth.',
              }),
            },
          },
        ],
      },
    } as any);

    const result = await AiResponseVerifierService.verifyAndCorrect({
      customerPhone: '62899999999',
      customerMessage: 'Adek agak grok-grok mau pijat sama sinar moksa',
      draftReply: 'Halo Bunda, untuk keluhan grok-grok kami sarankan Pijat Pulih Ceria dan Sinar Moksa ya',
      groundTruth: {
        customerAgeMonths: 5,
        allowedServices: [{ name: 'Pijat Bayi Pulih Ceria', category: 'BABY', minAgeMonths: 0.5, maxAgeMonths: 24, promoPrice: 70000 }],
      },
    });

    expect(result.finalReply).toContain('😊');
  });

  it('should accept Sinar Moksa for grok-grok complaints without hallucinating constipation', async () => {
    vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValueOnce({
      model: 'MiniMax-M2.7-highspeed',
      baseUrl: 'https://api.sumopod.com',
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                is_valid: true,
                violation_reasons: [],
                corrected_reply: null,
                confidence_score: 1.0,
                reasoning: 'QC PASSED: Sinar Moksa sangat tepat untuk keluhan napas grok-grok.',
              }),
            },
          },
        ],
      },
    } as any);

    const result = await AiResponseVerifierService.verifyAndCorrect({
      customerPhone: '62899999999',
      customerMessage: 'Adek nyaa gk pilek kak tp agak grok², kayak buntu mau pijat sama sinar moksa',
      draftReply: 'Halo Bunda! Untuk keluhan napas grok-grok dan agak buntu pada si kecil, treatment *Pijat Pulih Ceria* dipadukan dengan terapi *Sinar Moksa (Inframerah Hangat)* sangat tepat untuk membantu mengencerkan lendir dan melegakan napasnya ya Bunda. Rencana mau treatment di hari apa Bunda ? 😊',
      groundTruth: {
        customerAgeMonths: 4,
        allowedServices: [{ name: 'Pijat Bayi Pulih Ceria', category: 'BABY', minAgeMonths: 0.5, maxAgeMonths: 24, promoPrice: 70000 }],
      },
    });

    expect(result.wasCorrected).toBe(false);
    expect(result.finalReply).toContain('Pijat Pulih Ceria');
    expect(result.finalReply).toContain('Sinar Moksa');
    expect(result.finalReply).not.toContain('susah BAB');
    expect(result.finalReply).not.toContain('sembelit');
  });
});
