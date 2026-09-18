import { describe, it, expect, vi } from 'vitest';
import { GuardrailPipeline } from '../../../src/v3/agent/pipeline/guardrail-pipeline';

describe('GuardrailPipeline Anti-Mutilation (T0.2)', () => {
  const baseSession = {
    genderGreeting: 'Bunda',
    location: null,
    selectedTreatment: null,
    cartItems: [],
  } as any;

  it('Anti-mutilasi: pertanyaan usia pada balasan tidak dimutilasi/dipotong paksa oleh regex bila reprompt gagal', async () => {
    const draftReply = 'Untuk jadwalnya kami siap bantu Bunda. Usia si kecil berapa bulan ya Bund?';
    const mockExecuteChat = vi.fn().mockRejectedValue(new Error('Reprompt failed'));

    const out = await GuardrailPipeline.verifyAndReprompt({
      draftReply,
      incomingText: 'Bisa jadwal hari rabu besok?',
      isFollowUp: true,
      executedTools: [],
      retrievedChunks: [],
      session: baseSession,
      tenantId: 'default-tenant',
      phone: '628123456789',
      conversationId: 'conv-test-1',
      selectedModel: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      shouldSendReply: true,
      isEscalated: false,
      emptyKnowledgeResult: false,
      executeChat: mockExecuteChat,
      recordCall: vi.fn(),
      addUsage: vi.fn(),
      auditUsage: vi.fn(),
    });

    // Balasan asli harus tetap utuh, tidak terpotong cacat di tengah kalimat
    expect(out.finalReply).toBe(draftReply);
    expect(out.violationsDetected).toContain('age_solicitation_unresolved');
    expect(out.shouldSendReply).toBe(true);
  });
});
