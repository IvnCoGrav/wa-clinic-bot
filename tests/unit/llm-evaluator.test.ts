import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmEvaluatorService } from '../../src/services/llm-evaluator.service';
import { prisma } from '../../src/db/client';
import axios from 'axios';

vi.mock('axios');

vi.mock('../../src/db/client', () => ({
  prisma: {
    message: {
      findMany: vi.fn(),
    },
    aiEvaluation: {
      upsert: vi.fn(),
    },
  },
}));

describe('LLM-as-Judge Evaluator (Tahap 3)', () => {
  const tenantId = 'tenant-test';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LLM_API_KEY = 'sk-test-valid-key';
    delete process.env.AI_MAX_SAMPLES;
  });

  it('sampleMessages returns empty when no outbound message with aiReasoning today', async () => {
    vi.mocked(prisma.message.findMany).mockResolvedValueOnce([]);
    const svc = new LlmEvaluatorService();
    const samples = await svc.sampleMessages(tenantId, 10);
    expect(samples).toEqual([]);
    expect(prisma.message.findMany).toHaveBeenCalledTimes(1);
  });

  it('sampleAndEvaluate evaluates up to 10% sample and upserts score', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      id: `msg_${i}`,
      tenant_id: tenantId,
      conversation_id: `conv_${i}`,
      content: `Jawaban bot ${i}`,
      direction: 'OUTBOUND',
      payload_raw: { aiReasoning: `reasoning ${i}` },
      conversation: { customer: { phone: `6280000000${i}` } },
    }));

    vi.mocked(prisma.message.findMany).mockResolvedValueOnce(rows as any);
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        choices: [{ message: { content: JSON.stringify({ score: 4, feedback: 'Jawaban baik dan akurat.' }) } }],
      },
    } as any);
    vi.mocked(prisma.aiEvaluation.upsert).mockResolvedValueOnce({} as any);

    const svc = new LlmEvaluatorService();
    const count = await svc.sampleAndEvaluate(tenantId, 10);

    expect(count).toBe(1);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(prisma.aiEvaluation.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = vi.mocked(prisma.aiEvaluation.upsert).mock.calls[0][0] as any;
    expect(upsertArg.create.score).toBe(4);
  });

  it('returns 0 when LLM key is mock (no API call)', async () => {
    process.env.LLM_API_KEY = 'mock';
    vi.mocked(prisma.message.findMany).mockResolvedValueOnce([
      { id: 'm1', tenant_id: tenantId, conversation_id: null, content: 'x', direction: 'OUTBOUND', payload_raw: { aiReasoning: 'r' } },
    ] as any);

    const svc = new LlmEvaluatorService();
    const count = await svc.sampleAndEvaluate(tenantId, 10);
    expect(count).toBe(0);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('does not throw and returns 0 when DB is offline', async () => {
    vi.mocked(prisma.message.findMany).mockRejectedValue(new Error('Database offline'));
    const svc = new LlmEvaluatorService();
    const count = await svc.sampleAndEvaluate(tenantId, 10);
    expect(count).toBe(0);
  });

  it('does not throw and skips when evaluation LLM fails', async () => {
    vi.mocked(prisma.message.findMany).mockResolvedValueOnce([
      { id: 'm1', tenant_id: tenantId, conversation_id: null, content: 'x', direction: 'OUTBOUND', payload_raw: { aiReasoning: 'r' }, conversation: null },
    ] as any);
    vi.mocked(axios.post).mockRejectedValue(new Error('LLM down'));

    const svc = new LlmEvaluatorService();
    const count = await svc.sampleAndEvaluate(tenantId, 10);
    expect(count).toBe(0);
    expect(prisma.aiEvaluation.upsert).not.toHaveBeenCalled();
  });
});