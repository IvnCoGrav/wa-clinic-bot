import { describe, it, expect, vi, afterEach } from 'vitest';
import { GenerationStage } from '../../../src/v3/agent/pipeline/generation-stage';

/**
 * Fase 6 K4 — Enforce Cutover Readiness (lock-in, bukan red-first: mekanisme
 * sudah ada sejak Fase 2; test ini mengunci kontraknya).
 * Seam: GenerationStage.routeTools (Call-1) dengan LLM distub.
 * Kontrak: enforce ON (ENFORCE=true + SHADOW=false) → save_reservation
 * DICABUT dari tools Call-1 bila prasyarat masker gagal; default (shadow) →
 * tools penuh terkirim.
 */
describe('Tool-Masking Enforce Cutover', () => {
  const OLD_ENFORCE = process.env.TOOL_MASKING_ENFORCE;
  const OLD_SHADOW = process.env.TOOL_MASKING_SHADOW_MODE;

  afterEach(() => {
    if (OLD_ENFORCE === undefined) delete process.env.TOOL_MASKING_ENFORCE;
    else process.env.TOOL_MASKING_ENFORCE = OLD_ENFORCE;
    if (OLD_SHADOW === undefined) delete process.env.TOOL_MASKING_SHADOW_MODE;
    else process.env.TOOL_MASKING_SHADOW_MODE = OLD_SHADOW;
    vi.restoreAllMocks();
  });

  async function routeWithCapture() {
    let capturedTools: any[] = [];
    const spy = vi.spyOn(GenerationStage, 'executeChatCompletion').mockImplementation(async (params: any) => {
      capturedTools = params?.payload?.tools || [];
      return {
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: {},
      } as any;
    });
    const turn: any = {
      tenantId: 'default-tenant',
      phone: '6281',
      conversationId: 'conv-enforce-1',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'k',
      selectedModel: 'm',
      reasoning: null,
    };
    const tel: any = { addUsage: async () => {}, auditUsage: async () => {}, recordCall: async () => {} };
    await GenerationStage.routeTools(turn, tel, {
      cleanIncomingText: 'halo',
      session: { genderGreeting: 'Bunda' } as any,
      messages: [{ role: 'user', content: 'halo' }],
      grounding: { hasFallInjury: false, hasVaccineSignal: false } as any,
      conversationHistory: [],
    });
    spy.mockRestore();
    return capturedTools.map((t: any) => t?.function?.name || t?.name);
  }

  it('enforce ON: save_reservation dicabut dari tools Call-1 (fail-closed)', async () => {
    process.env.TOOL_MASKING_ENFORCE = 'true';
    process.env.TOOL_MASKING_SHADOW_MODE = 'false';
    const names = await routeWithCapture();
    expect(names).not.toContain('save_reservation');
    expect(names).toContain('get_catalog_and_price');
    expect(names).toContain('calculate_delivery');
  });

  it('default shadow: tools penuh terkirim (perilaku produksi utuh)', async () => {
    delete process.env.TOOL_MASKING_ENFORCE;
    const names = await routeWithCapture();
    expect(names).toContain('save_reservation');
  });
});
