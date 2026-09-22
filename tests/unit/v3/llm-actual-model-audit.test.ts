import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TurnState } from '../../../src/v3/agent/pipeline/generation-stage';
import { createTelemetry } from '../../../src/v3/agent/pipeline/generation-stage';
import { reportTurnError } from '../../../src/v3/agent/pipeline/generation-stage';

// Mock the audit buffer
vi.mock('../../../src/utils/llm-audit-buffer', () => ({
  auditLlmCall: vi.fn(),
}));

vi.mock('../../../src/utils/llm-execution-logger', () => ({
  recordLlmExecution: vi.fn(),
}));

vi.mock('../../../utils/cost-calculator', () => ({
  calculateLlmCost: vi.fn().mockResolvedValue({ totalCostIdr: 100 }),
}));

// Mock session object for testing
const mockSession = {
  phone: '628123456789',
  tenantId: 'test-tenant',
};

describe('LLM Actual Model Audit — fallback observability', () => {
  let mockTurn: TurnState;
  let mockTel: ReturnType<typeof createTelemetry>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTurn = {
      tenantId: 'test-tenant',
      phone: '628123456789',
      conversationId: 'conv-123',
      incomingText: 'halo',
      selectedModel: 'glm-5.3-flash',
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'test-key',
      turnStartedAt: Date.now(),
      correlationId: 'corr-123',
      totalTokens: { prompt: 0, completion: 0, total: 0 },
      currentSystemPrompt: 'test prompt',
      messages: [],
      executedTools: [],
      retrievedChunks: [],
      fewShotExemplars: [],
      reasoning: null,
      perCallLogged: false,
    } as TurnState;

    mockTel = createTelemetry(mockTurn);
  });

  it('auditUsage mencatat actualModel saat fallback terjadi (Call 1)', async () => {
    const { auditLlmCall } = await import('../../../src/utils/llm-audit-buffer');

    // Simulasikan response dari fallback dengan __actualModel
    const fallbackResponse = {
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      __actualModel: 'deepseek-chat',
      __actualProvider: 'DeepSeek Direct',
    };

    // Panggil auditUsage dengan actualModel dari fallback
    await mockTel.auditUsage(fallbackResponse.usage, mockTurn.turnStartedAt, fallbackResponse.__actualModel, fallbackResponse.__actualProvider);

    // Verifikasi auditLlmCall dipanggil dengan actualModel, bukan selectedModel
    expect(auditLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        model_name: 'deepseek-chat',
        baseUrl: 'DeepSeek Direct',
      })
    );
    // Pastikan TIDAK menggunakan selectedModel (glm-5.3-flash)
    expect(auditLlmCall).not.toHaveBeenCalledWith(
      expect.objectContaining({
        model_name: 'glm-5.3-flash',
      })
    );
  });

  it('auditUsage mencatat actualModel saat fallback terjadi (Call 2)', async () => {
    const { auditLlmCall } = await import('../../../src/utils/llm-audit-buffer');

    const fallbackResponse = {
      usage: { prompt_tokens: 200, completion_tokens: 100 },
      __actualModel: 'deepseek-v4-flash-0731:netra',
      __actualProvider: 'SumoPod',
    };

    await mockTel.auditUsage(fallbackResponse.usage, mockTurn.turnStartedAt, fallbackResponse.__actualModel, fallbackResponse.__actualProvider);

    expect(auditLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        model_name: 'deepseek-v4-flash-0731:netra',
        baseUrl: 'SumoPod',
      })
    );
  });

  it('auditUsage fallback ke selectedModel ketika actualModel tidak ada', async () => {
    const { auditLlmCall } = await import('../../../src/utils/llm-audit-buffer');

    const normalResponse = {
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      // tanpa __actualModel
    };

    await mockTel.auditUsage(normalResponse.usage, mockTurn.turnStartedAt);

    expect(auditLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        model_name: 'glm-5.3-flash', // fallback ke selectedModel
        baseUrl: 'https://ai.sumopod.com/v1',
      })
    );
  });

  it('reportTurnError menggunakan actualModelUsed untuk audit error', async () => {
    const { auditLlmCall } = await import('../../../src/utils/llm-audit-buffer');

    // Set actualModelUsed pada turn (simulasi fallback sudah terjadi)
    mockTurn.actualModelUsed = 'deepseek-chat';

    const testError = new Error('Connection timeout');

    await reportTurnError(mockTurn, mockSession as any, testError, 'halo');

    // Verifikasi audit error menggunakan actualModelUsed
    expect(auditLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        model_name: 'deepseek-chat',
        error: expect.objectContaining({ message: 'Connection timeout' }),
      })
    );
  });

  it('finishCost mengembalikan biaya tanpa error menggunakan actualModelUsed', async () => {
    mockTurn.actualModelUsed = 'deepseek-chat';
    mockTurn.totalTokens = { prompt: 1000, completion: 500, total: 1500 };

    const { createTelemetry: createTel } = await import('../../../src/v3/agent/pipeline/generation-stage');
    const tel = createTel(mockTurn);

    const cost = await tel.finishCost();

    // Hanya verifikasi tidak throw dan mengembalikan number
    expect(typeof cost).toBe('number');
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});