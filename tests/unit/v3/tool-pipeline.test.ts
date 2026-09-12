import { describe, it, expect } from 'vitest';
import { ToolExecutionPipeline } from '../../../src/v3/agent/pipeline/tool-pipeline';

/**
 * Stage 2-3 isolation: eksekusi tool + reduksi session tanpa LLM.
 * Tool get_catalog_and_price berjalan offline via katalog in-memory.
 */
describe('ToolExecutionPipeline — eksekusi & state reducer (tanpa LLM)', () => {
  const baseInput = (overrides: any = {}) => ({
    toolCalls: [
      {
        id: 'call-1',
        function: {
          name: 'get_catalog_and_price',
          arguments: JSON.stringify({ specificTreatmentName: 'Pijat Bayi Ceria', inquirePrice: true }),
        },
      },
    ],
    assistantMessage: { role: 'assistant', content: null, tool_calls: [] },
    session: { cartItems: [] } as any,
    tenantId: 'default-tenant',
    customerId: 'cust-1',
    phone: '6281',
    conversationId: 'conv-tp-1',
    chatId: '6281@c.us',
    conversationHistory: [],
    cleanIncomingText: 'pijat bayi ceria berapa?',
    grounding: {
      phase: 'GENERAL',
      phaseDirective: '',
      hasScheduleSignal: false,
      hasFallInjury: false,
      hasVaccineSignal: false,
      timeHint: null,
      retrievedChunks: [],
      emptyKnowledgeResult: false,
      bundleCompositionNote: null,
      preGroundingBlock: '',
    },
    seenChunkKeys: new Set<string>(),
    retrievedChunks: [] as any[],
    messages: [{ role: 'system', content: 'sys' }] as any[],
    ...overrides,
  });

  it('mengeksekusi get_catalog_and_price + push pesan tool + observability katalog', async () => {
    const input = baseInput();
    const out = await ToolExecutionPipeline.execute(input);
    expect(out.executedTools.length).toBe(1);
    expect(out.executedTools[0].name).toBe('get_catalog_and_price');
    expect(out.executedTools[0].result.success).toBe(true);
    expect(out.isEscalated).toBe(false);
    expect(out.inquirePriceSignal).toBe(true);
    // messages: system + assistant + tool
    expect(input.messages.length).toBe(3);
    expect(input.messages[2].role).toBe('tool');
    // katalog terdaftar di observability chunks
    expect(input.retrievedChunks.some((c: any) => String(c.id).startsWith('catalog-'))).toBe(true);
  });

  it('escalate_to_human → isEscalated tanpa balasan lanjutan', async () => {
    const input = baseInput({
      toolCalls: [
        {
          id: 'call-2',
          function: {
            name: 'escalate_to_human',
            arguments: JSON.stringify({ reason: 'test', severity: 'CUSTOMER_REQUEST' }),
          },
        },
      ],
    });
    const out = await ToolExecutionPipeline.execute(input);
    expect(out.isEscalated).toBe(true);
    expect(out.executedTools[0].name).toBe('escalate_to_human');
  });

  it('argumen tak valid → result error tanpa throw', async () => {
    const input = baseInput({
      toolCalls: [
        { id: 'call-3', function: { name: 'save_reservation', arguments: JSON.stringify({}) } },
      ],
    });
    const out = await ToolExecutionPipeline.execute(input);
    expect(out.executedTools[0].result.error).toBeDefined();
    expect(out.isEscalated).toBe(false);
  });
});
