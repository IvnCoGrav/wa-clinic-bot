import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationState } from '@prisma/client';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { GoalTracker, __clearMemorySessions } from '../../src/v3/state/goal-tracker';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Mekanisme C — Sapaan data-driven: TANPA tebakan dari nama.
 * genderGreeting hanya dari deklarasi eksplisit tersimpan, selain itu default "Bunda".
 */
describe('Gender Greeting — netral, tanpa inferensi nama', () => {
  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    vi.restoreAllMocks();
    __clearMemorySessions();
  });

  describe('detectExplicitGenderPreference', () => {
    it.each([
      'Rizki Dwi S',
      'Bapak Naufal',
      'Halo kak',
      'Pagi kak mau tanya lokernya masih tersedia ?',
    ])('"%s" → null (nama/sapaan BUKAN deklarasi)', (text) => {
      expect(GoalTracker.detectExplicitGenderPreference(text)).toBeNull();
    });

    it.each([
      'saya bapaknya kak',
      'Saya Bapak 2 anak',
      'panggil saya bapak aja',
      'aku ayah dari bayinya',
    ])('"%s" → Bapak', (text) => {
      expect(GoalTracker.detectExplicitGenderPreference(text)).toBe('Bapak');
    });

    it.each([
      'saya ibunya',
      'panggil saya ibu saja',
      'aku bundanya kak',
    ])('"%s" → Bunda', (text) => {
      expect(GoalTracker.detectExplicitGenderPreference(text)).toBe('Bunda');
    });

    it.each([
      'tolong panggil bapak saya',
      'bapak bisa pijat?',
      'kata bapak saya mahal',
    ])('adversarial rujukan pihak ketiga "%s" → null', (text) => {
      expect(GoalTracker.detectExplicitGenderPreference(text)).toBeNull();
    });
  });

  describe('getGoalSession — default & persistensi preferensi', () => {
    it('tanpa preferensi tersimpan → default "Bunda" walau nama mengandung "dwi"', async () => {
      const session = await GoalTracker.getGoalSession('conv-no-pref-1', DEFAULT_TENANT_ID);
      expect(session.genderGreeting).toBe('Bunda');
    });

    it('round-trip offline: updateGender → getGoalSession mengembalikan nilai tersimpan', async () => {
      await GoalTracker.updateGoalSession('conv-pref-1', { genderGreeting: 'Bapak' }, DEFAULT_TENANT_ID);
      const session = await GoalTracker.getGoalSession('conv-pref-1', DEFAULT_TENANT_ID);
      expect(session.genderGreeting).toBe('Bapak');
    });
  });

  describe('machine — deklarasi eksplisit tersimpan pre-V3', () => {
    it('"saya bapaknya" + tanya harga → genderGreeting tersimpan Bapak, V3 tetap jalan', async () => {
      const sentToCustomer: string[] = [];
      const sm = new ConversationStateMachine({
        simulateHumanReply: async (params: any) => {
          sentToCustomer.push(params.replyText);
          return { success: true };
        },
      } as any);
      const phone = `62895${Date.now()}`;
      const customer = await customerService.getOrCreateCustomer(phone, 'Rizki Dwi S', DEFAULT_TENANT_ID);
      const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
      const v3Spy = vi.spyOn(V3AgentRunner, 'processMessage').mockResolvedValue({
        replyText: 'mocked',
        executedTools: [],
        updatedSession: {},
        shouldSendReply: true,
        isEscalated: false,
        retrievedChunks: [],
        fewShotExemplars: [],
        systemPrompt: '',
        reasoning: null,
        tokens: { prompt: 0, completion: 0, total: 0 },
        costIdr: 0,
      } as any);

      await sm.processMessage({
        tenantId: DEFAULT_TENANT_ID,
        customer,
        conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
        incomingMessage: {
          id: `msg_gdr_${Date.now()}`,
          from: phone,
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'saya bapaknya, berapa harga pijat bayi?' },
        },
      });

      expect(v3Spy).toHaveBeenCalledTimes(1);
      const session = await GoalTracker.getGoalSession(conversation.id, DEFAULT_TENANT_ID);
      expect(session.genderGreeting).toBe('Bapak');
    });
  });
});
