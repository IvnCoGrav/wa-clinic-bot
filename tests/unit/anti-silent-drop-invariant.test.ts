import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationState } from '@prisma/client';
import { GuardrailPipeline } from '../../src/v3/agent/pipeline/guardrail-pipeline';
import { GenerationStage } from '../../src/v3/agent/pipeline/generation-stage';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * TIER 1 REGRESSION SUITE: ANTI-SILENT-DROP INVARIANT (Offline, Stubs, Zero Cost)
 *
 * Invariant: Bot TIDAK BOLEH PERNAH mengirim balasan kosong ('') atau mendiamkan customer
 * tanpa balasan (silent-drop / shouldSendReply = false saat ada pesan masuk), apa pun
 * yang terjadi di lapisan dalam (validator numerik, faktual, pronoun, age, visit-time,
 * maupun sanitasi output).
 *
 * SATU-SATUNYA PENGECUALIAN (keputusan owner, Fase B — docs/KNOWN_ISSUES#853 &
 * CHANGELOG#5705): **outage LLM total** → eskalasi sunyi TANPA apology, antrean CS
 * didahulukan (diverifikasi di describe blok 4).
 */
describe('Anti-Silent-Drop Invariant (Tier 1 Offline)', () => {
  const dummySession: any = {
    genderGreeting: 'Bunda',
    cartItems: [],
    location: null,
  };

  const defaultPipelineParams = {
    tenantId: DEFAULT_TENANT_ID,
    phone: '628123456789',
    conversationId: 'conv_anti_silent_drop',
    selectedModel: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'mock-key',
    incomingText: 'Halo Bidan',
    isFollowUp: true,
    executedTools: [],
    retrievedChunks: [],
    session: dummySession,
    shouldSendReply: true,
    isEscalated: false,
    emptyKnowledgeResult: false,
    executeChat: vi.fn(),
    recordCall: vi.fn().mockResolvedValue(undefined),
    addUsage: vi.fn(),
    auditUsage: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Double-Layer Protection Terhadap Draf Kosong / Spasi', () => {
    it('Draf kosong murni ("") pada non-eskalasi follow-up → recovery kontekstual TANPA greeting pembuka (tidak kosong)', async () => {
      const result = await GuardrailPipeline.verifyAndReprompt({
        ...defaultPipelineParams,
        draftReply: '',
        isEscalated: false,
      });

      expect(result.finalReply).toBeDefined();
      expect(result.finalReply.trim().length).toBeGreaterThan(0);
      expect(result.finalReply).toMatch(/Baik Bunda.*Kami pastikan informasi/is);
      expect(result.finalReply).not.toMatch(/Terima kasih sudah menghubungi kami/);
      expect(result.shouldSendReply).toBe(true);
    });

    it('Draf kosong murni ("") pada kondisi eskalasi → ditangkap Terminal Catch-All Guard menjadi fallback eskalasi sopan', async () => {
      const result = await GuardrailPipeline.verifyAndReprompt({
        ...defaultPipelineParams,
        draftReply: '',
        isEscalated: true,
      });

      expect(result.finalReply).toBeDefined();
      expect(result.finalReply.trim().length).toBeGreaterThan(0);
      expect(result.finalReply).toMatch(/Mohon maaf Bunda.*kami teruskan langsung ke tim Bidan kami/i);
      expect(result.shouldSendReply).toBe(true);
      expect(result.isEscalated).toBe(true);
      expect(result.violationsDetected).toContain('TERMINAL_SILENT_DROP_GUARD: finalReply kosong diganti fallback');
    });

    it('Draf hanya spasi ("   ") pada kondisi eskalasi → terminal guard mengisi fallback eskalasi sopan', async () => {
      const result = await GuardrailPipeline.verifyAndReprompt({
        ...defaultPipelineParams,
        draftReply: '   \n\t  ',
        isEscalated: true,
      });

      expect(result.finalReply.trim().length).toBeGreaterThan(0);
      expect(result.finalReply).toMatch(/Mohon maaf Bunda.*kami teruskan langsung ke tim Bidan kami/i);
      expect(result.shouldSendReply).toBe(true);
      expect(result.isEscalated).toBe(true);
    });
  });

  describe('2. Validator Faktual Gagal Total (Reprompt Gagal / Halusinasi Fatal)', () => {
    it('Jika validator faktual reject dan reprompt tetap invalid → wajib kirim fallback ramah, bukan silent-drop', async () => {
      // Mock executeChat mengembalikan draf yang tetap melanggar klaim absolut
      const executeChatMock = vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'Dijamin 100% sembuh total tanpa efek samping ya Bunda.' } }],
      });

      const result = await GuardrailPipeline.verifyAndReprompt({
        ...defaultPipelineParams,
        draftReply: 'Pijat ini dijamin menyembuhkan batuk pilek 100% ya Bunda.',
        executeChat: executeChatMock,
      });

      expect(result.finalReply).toBeDefined();
      expect(result.finalReply.trim().length).toBeGreaterThan(0);
      expect(result.finalReply).toMatch(/Mohon maaf Bunda.*kami teruskan langsung ke tim Bidan kami/i);
      expect(result.shouldSendReply).toBe(true);
      expect(result.isEscalated).toBe(true);
      expect(result.violationsDetected.some((v) => v.includes('SILENT_DROP_PREVENTED'))).toBe(true);
    });

    it('Jika reprompt faktual throw error (network/timeout) → fallback eskalasi ramah tetap dikirim', async () => {
      const executeChatMock = vi.fn().mockRejectedValue(new Error('LLM timeout 504'));

      const result = await GuardrailPipeline.verifyAndReprompt({
        ...defaultPipelineParams,
        draftReply: 'Pijat ini dijamin menyembuhkan batuk pilek 100% ya Bunda.',
        executeChat: executeChatMock,
      });

      expect(result.finalReply.trim().length).toBeGreaterThan(0);
      expect(result.finalReply).toMatch(/Mohon maaf Bunda.*kami teruskan langsung ke tim Bidan kami/i);
      expect(result.shouldSendReply).toBe(true);
      expect(result.isEscalated).toBe(true);
    });
  });

  describe('3. Validator Pronoun & Age Gagal (Pelanggaran Gaya)', () => {
    it('Jika pronoun validator reject dan reprompt throw error → balasan asli dipertahankan, TIDAK dikosongkan', async () => {
      const executeChatMock = vi.fn().mockRejectedValue(new Error('Rate limit'));

      const result = await GuardrailPipeline.verifyAndReprompt({
        ...defaultPipelineParams,
        draftReply: 'Halo Bunda, saya bisa bantu jadwalkan homecare.',
        executeChat: executeChatMock,
      });

      expect(result.finalReply.trim().length).toBeGreaterThan(0);
      expect(result.shouldSendReply).toBe(true);
      // Pronoun slip adalah pelanggaran gaya, bukan alasan membisukan bot
      expect(result.violationsDetected.some((v) => v.includes('first_person_slip') || v.includes('saya'))).toBe(true);
    });

    it('Jika age solicitor reject dan reprompt gagal → balasan asli dipertahankan, TIDAK dikosongkan', async () => {
      const executeChatMock = vi.fn().mockRejectedValue(new Error('LLM error'));

      const result = await GuardrailPipeline.verifyAndReprompt({
        ...defaultPipelineParams,
        draftReply: 'Halo Bunda, usia si kecil berapa bulan ya?',
        executeChat: executeChatMock,
      });

      expect(result.finalReply.trim().length).toBeGreaterThan(0);
      expect(result.shouldSendReply).toBe(true);
    });
  });

  describe('4. Runner Global Error Boundary (Uncaught Exceptions / Pipeline Crash)', () => {
    it('LLM outage total → eskalasi sunyi: NOL balasan apology, tetap tercatat HUMAN_HANDLING', async () => {
      const sentToCustomer: string[] = [];
      const sm = new ConversationStateMachine({
        simulateHumanReply: async (params: any) => {
          sentToCustomer.push(params.replyText);
          return { success: true };
        },
      } as any);

      process.env.HUMANIZER_ENABLED = 'false';
      process.env.LLM_API_KEY = 'mock_key';

      // Paksa GenerationStage melempar fatal error (outage LLM total)
      vi.spyOn(GenerationStage, 'executeChatCompletion').mockRejectedValue(
        new Error('Fatal upstream 500 server error')
      );

      const phone = `62899${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Crash Test', DEFAULT_TENANT_ID);
      const escSpy = vi.spyOn(conversationService, 'escalateToHumanHandling');
      const result = await sm.processMessage({
        tenantId: DEFAULT_TENANT_ID,
        customer,
        conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
        incomingMessage: {
          id: `msg_crash_${Date.now()}`,
          from: phone,
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'Tolong bantu dong' },
        },
      });

      // Keputusan owner (Fase B): outage total → TANPA apology minta-coba-lagi,
      // eskalasi sunyi ke human handling. Antrean CS didahulukan daripada skenario apology.
      expect(result.shouldSendReply).toBe(false);
      expect(result.replyText).toBeFalsy();
      expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
      expect(sentToCustomer.length).toBe(0);
      expect(escSpy.mock.calls.length).toBeGreaterThan(0);
      const updated = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
      expect(updated.is_human_handling).toBe(true);
    });
  });
});
