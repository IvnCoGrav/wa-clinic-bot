import { describe, it, expect, vi } from 'vitest';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { GenerationStage } from '../../src/v3/agent/pipeline/generation-stage';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { setupOfflineEnv } from './helpers/chat-harness';
import { captureWarningEvents } from './helpers/warning-capture';

setupOfflineEnv();

function stubEmptyRouter() {
  return vi.spyOn(GenerationStage, 'executeChatCompletion').mockImplementation(async ({ payload }: any) => {
    const isRouting = Array.isArray(payload?.tools) && payload.tools.length > 0;
    if (isRouting) {
      return {
        choices: [{ message: { content: '' }, finish_reason: 'stop' }],
        usage: {},
      };
    }
    return {
      choices: [{ message: { content: 'Baik Bunda, ongkir ke Sedati sudah kami cek.' } }],
      usage: {},
    };
  });
}

describe('Router Call 1 kosong dengan sinyal lokasi', () => {
  it('mengeksekusi calculate_delivery, bukan fallback kalengan', async () => {
    const warnings = captureWarningEvents();
    const spy = stubEmptyRouter();
    try {
      const result = await V3AgentRunner.processMessage({
        tenantId: DEFAULT_TENANT_ID,
        customerId: 'router_empty_1',
        conversationId: 'conv_router_empty_1',
        phone: '62811111111',
        chatId: '62811111111@c.us',
        incomingText: 'Berapa ongkir ke Sedati?',
        history: [],
        skipDbLogging: true,
      });

      expect(result.executedTools.map((t) => t.name)).toContain('calculate_delivery');
      expect(result.replyText).not.toContain('Kami pastikan informasinya terlebih dahulu');
      expect(
        warnings.events.some((e) => e.event === 'CALL1_EMPTY_FORCED_TOOL_FALLBACK_APPLIED')
      ).toBe(true);
      expect(warnings.events.some((e) => e.event === 'V3_TOOL_SCHEMA_REJECTED')).toBe(false);
    } finally {
      spy.mockRestore();
      warnings.restore();
    }
  });
});
