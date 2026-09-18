import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { GenerationStage } from '../../src/v3/agent/pipeline/generation-stage';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * KONTRAK BARU (pembalikan disengaja 2026-09-17, revisi fondasional P3):
 * Medical escalation WAJIB disertai balasan keselamatan deterministik ke
 * customer (eskalasi AMAN, bukan diam). Template tetap tanpa anjuran dosis,
 * tanpa tawaran pijat, tanpa ajakan jadwal — nol risiko nasihat medis.
 * Kontrak lama ("Alert Admin Only, Customer Silent") dipensiunkan karena
 * diam total saat potensi darurat melanggar invarian anti-silent-drop.
 */

vi.mock('../../src/integrations/llm/llm-gateway', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/integrations/llm/llm-gateway')>();
  return {
    ...original,
    getLlmEndpointConfig: vi.fn().mockReturnValue({
      baseUrl: 'https://mock.api.openai.com/v1',
      apiKey: 'mock-api-key',
      timeoutMs: 30000,
      fallbackModel: null,
    }),
  };
});

vi.mock('../../src/integrations/llm/model-fallback', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/integrations/llm/model-fallback')>();
  return {
    ...original,
    callChatCompletionsWithFallback: vi.fn().mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: 'Baik Bunda, terima kasih. Kami bantu cek ya.',
          },
        }],
      },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      latencyMs: 100,
      isPrimaryModel: true,
      modelUsed: 'gpt-4o-mini',
      retryCount: 0,
    }),
  };
});

describe('Medical Escalation — Alert Admin + Balasan Keselamatan Deterministik', () => {
  let sentToCustomer: string[] = [];
  let notifyAlertCalls: any[] = [];

  const mockTypingService = {
    simulateHumanReply: async (params: any) => {
      sentToCustomer.push(params.replyText);
      return { success: true };
    },
  } as any;

  const testStateMachine = new ConversationStateMachine(mockTypingService);

  beforeEach(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    sentToCustomer = [];
    notifyAlertCalls = [];

    // Mock AlertService: tangkap panggilan notifyAlert
    const { AlertService } = await import('../../src/services/alert.service');
    (AlertService as any).prototype.notifyAlert = async (payload: any) => { notifyAlertCalls.push(payload); };
  });

  it('HIGH severity → alert admin + balasan darurat deterministik (TANPA diam)', async () => {
    const phone = `62891${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Medical', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      { currentState: ConversationState.AWAITING_LOCATION, isHumanHandling: false },
      DEFAULT_TENANT_ID
    );

    const result = await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_med_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'Anak saya demam tinggi banget dan kejang step' },
      },
    });

    expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(result.isHumanHandling).toBe(true);
    // Eskalasi AMAN: customer langsung menerima arahan keselamatan.
    expect(result.shouldSendReply).toBe(true);
    expect(String(result.replyText || '')).toMatch(/dokter\/faskes|IGD/i);
    expect(String(result.replyText || '')).toMatch(/tim Bidan kami/i);
    // Nol risiko nasihat medis: tanpa dosis/angka obat, tanpa klaim sembuh,
    // tanpa ajakan jadwal. ("pijat"/"hari" telanjang tidak dilarang: template
    // memakai negasi klarifikasi "tidak bisa ditangani dengan pijat".)
    expect(String(result.replyText || '')).not.toMatch(/paracetamol|dosis|\b\d+\s*ml\b|menyembuhkan|konfirmasi jadwal/i);
  });

  it('MEDIUM severity → alert admin + balasan concern deterministik (TANPA diam)', async () => {
    const phone = `62892${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Med2', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      { currentState: ConversationState.AWAITING_LOCATION, isHumanHandling: false },
      DEFAULT_TENANT_ID
    );

    const result = await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_med2_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'Pusar bayi saya ruam tali pusat dan bintik merah' },
      },
    });

    expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(result.shouldSendReply).toBe(true);
    expect(String(result.replyText || '')).toMatch(/tim Bidan kami/i);
    expect(String(result.replyText || '')).toMatch(/dokter\/faskes/i);
  });

  it('Non-medical message → normal flow, tidak ter-escalate', async () => {
    // Kontrak Fase B: V3 yang throw (outage) = eskalasi. Maka uji "normal flow"
    // WAJIB memalsukan LLM di lapisan executeChatCompletion agar V3 sukses.
    vi.spyOn(GenerationStage, 'executeChatCompletion').mockResolvedValue({
      choices: [{ message: { content: 'Baik Bunda, berikut info harga paket pijat bayi ya.' } }],
    } as any);
    const phone = `62893${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Normal', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      { currentState: ConversationState.AWAITING_LOCATION, isHumanHandling: false },
      DEFAULT_TENANT_ID
    );

    const result = await testStateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_norm_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'Berapa harga paket pijat bayi?' },
      },
    });

    // Bukan medical → bukan HUMAN_HANDLING karena medical (bisa state lain)
    expect(result.isHumanHandling).not.toBe(true);
  });
});
