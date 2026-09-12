import { describe, it, expect, vi } from 'vitest';
import { GuardrailPipeline } from '../../../src/v3/agent/pipeline/guardrail-pipeline';

/**
 * Stage 5 isolation: reprompt terisolasi pada pelanggaran numerik/pronoun
 * dengan LLM mock (tanpa network).
 */
describe('GuardrailPipeline — reprompt terisolasi (LLM mock)', () => {
  const baseInput = (overrides: any = {}) => ({
    draftReply: '',
    incomingText: 'berapa harganya kak?',
    isFollowUp: true,
    executedTools: [] as any[],
    retrievedChunks: [] as any[],
    session: { cartItems: [] } as any,
    tenantId: 'default-tenant',
    phone: '6281',
    conversationId: 'conv-gp-1',
    selectedModel: 'mock-model',
    baseUrl: 'https://mock.test/v1',
    apiKey: 'k',
    shouldSendReply: true,
    isEscalated: false,
    emptyKnowledgeResult: false,
    executeChat: vi.fn(),
    recordCall: vi.fn(),
    addUsage: vi.fn(),
    auditUsage: vi.fn(),
    ...overrides,
  });

  it('pelanggaran numerik → reprompt 1x lalu balasan resmi dipakai', async () => {
    const executeChat = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Paketnya *Rp 75.000* ya Bunda 😊' } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });
    const out = await GuardrailPipeline.verifyAndReprompt(baseInput({
      draftReply: 'Paketnya Rp 10.000 ya Bunda.',
      executedTools: [{
        name: 'get_catalog_and_price',
        args: { inquirePrice: true },
        result: { treatments: [{ name: 'Pijat Bayi Pulih Ceria', promoPrice: 75000, originalPrice: 100000 }] },
      }],
      executeChat,
    }));
    expect(out.violationsDetected.length).toBeGreaterThan(0);
    expect(out.repromptCount).toBeGreaterThanOrEqual(1);
    expect(out.finalReply).toContain('75.000');
    expect(executeChat).toHaveBeenCalledTimes(1);
  });

  it('slip pronoun "saya" → reprompt koreksi kata ganti', async () => {
    const executeChat = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Bisa banget Bunda 😊 Nanti Bidan kami bantu pilihkan.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });
    const out = await GuardrailPipeline.verifyAndReprompt(baseInput({
      draftReply: 'Bisa banget Bunda, nanti saya bantu pilihkan.',
      executeChat,
    }));
    expect(out.finalReply).not.toMatch(/\bsaya\b/i);
    expect(out.finalReply).toContain('kami');
  });

  it('draf bersih → tanpa reprompt, tanpa executor call', async () => {
    const executeChat = vi.fn();
    const out = await GuardrailPipeline.verifyAndReprompt(baseInput({
      draftReply: 'Baik Bunda 😊',
      executeChat,
    }));
    expect(out.repromptCount).toBe(0);
    expect(executeChat).not.toHaveBeenCalled();
    expect(out.finalReply).toContain('Baik Bunda');
  });
});
