import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { stateMachine } from '../../src/state-machine/machine';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { knowledgeBaseService } from '../../src/services/knowledge.service';
import { llmResponseGenerator } from '../../src/integrations/llm/generator';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * FAQ No-Treatment-Leak — verifikasi GUARD ANTI HARD-SELLING pada jalur FAQ:
 * pertanyaan edukatif murni (usia minimal, dll.) TIDAK boleh mengisi
 * treatmentNameForFollowUp (arg ke-5 generateFaqResponseWithDetails) dari match
 * katalog fuzzy — supaya CTA LLM tidak memaksa menawarkan paket yang tidak
 * ditanyakan (mis. "Paket Selapan"). Sebaliknya, jika customer menyebut NAMA
 * FULL treatment (exact phrase), nama tersebut tetap dikirim untuk CTA personal.
 *
 * Jalur: state AWAITING_INTEREST → handleInterestState → case faq_question.
 * LLM dimock (offline): searchRelevantChunks + generateFaqResponseWithDetails.
 */
function setupMockExpectations() {
  vi.spyOn(knowledgeBaseService, 'searchRelevantChunks').mockResolvedValue([
    {
      id: 'chunk-faq-umum',
      tenantId: DEFAULT_TENANT_ID,
      sourceType: 'faq',
      title: 'FAQ Umum',
      content: 'Pertanyaan: Usia minimal pijat bayi berapa? Jawaban: Pijat bayi bisa mulai usia minimal 2 minggu.',
      documentName: 'faq',
    },
  ]);
  return vi.spyOn(llmResponseGenerator, 'generateFaqResponseWithDetails').mockResolvedValue({
    answer: 'Pijat bayi bisa dimulai minimal usia 2 minggu ya Bunda. 😊',
    reasoning: '[MOCK]',
  });
}

describe('FAQ No-Treatment-Leak — guard anti hard-selling treatmentNameForFollowUp', () => {
  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    vi.restoreAllMocks();
  });

  async function setupCustomer(state: ConversationState, phonePrefix: string) {
    const phone = `${phonePrefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Test Faq Leak', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      { currentState: state, isHumanHandling: false },
      DEFAULT_TENANT_ID
    );
    customer.kelurahan = 'Wedoro';
    customer.kecamatan = 'Waru';
    customer.lat = -7.348395;
    customer.lng = 112.7494759;
    return { phone, customer, conversation };
  }

  async function runQuestion(body: string, phonePrefix: string) {
    const { phone, customer } = await setupCustomer(ConversationState.AWAITING_INTEREST, phonePrefix);
    const result = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_faqleak_${Date.now()}_${Math.random()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body },
      },
    });
    return result;
  }

  it('1. "pijat bayi min usia brp ya?" (FAQ usia) → treatmentNameForFollowUp undefined (no leak)', async () => {
    const spy = setupMockExpectations();
    const result = await runQuestion('Selamat sore. Saya ingin tanya untuk pijat bayi min. di usia brp ya?', '628801');
    expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(result.shouldSendReply).toBe(true);
    expect(spy).toHaveBeenCalled();
    const args = spy.mock.calls[0];
    expect(args[4]).toBeUndefined();
  });

  it('2. "usia berapa bayi boleh pijat?" (FAQ usia, tanpa nama) → treatmentNameForFollowUp undefined', async () => {
    const spy = setupMockExpectations();
    const result = await runQuestion('usia berapa bayi boleh pijat?', '628802');
    expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(args4Of(spy)).toBeUndefined();
  });

  it('3. "buka jam berapa hari ini?" → jika FAQ generator dipanggil, treatmentNameForFollowUp tetap undefined', async () => {
    // Sanity: pertanyaan jadwal/jam tidak boleh membawa treatmentNameForFollowUp.
    // (Dalam test-env intent fallback ter-route ke faq_question → generator terpanggil;
    // poin pentingnya: arg treatment wajib undefined — tidak ada forced CTA.)
    const spy = setupMockExpectations();
    const result = await runQuestion('buka jam berapa hari ini?', '628803');
    expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
    if (spy.mock.calls.length > 0) {
      expect(spy.mock.calls[0][4]).toBeUndefined();
    }
  });

  it('4. "pijat bayi ceria aman untuk bayi 3 bulan ya?" (nama FULL disebut) → "Pijat Bayi Ceria"', async () => {
    const spy = setupMockExpectations();
    const result = await runQuestion('pijat bayi ceria aman untuk bayi 3 bulan ya?', '628804');
    expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(args4Of(spy)).toBe('Pijat Bayi Ceria');
  });

  it('5. "nebulizer itu buat apa ya?" (nama FULL disebut) → "Nebulizer"', async () => {
    const spy = setupMockExpectations();
    const result = await runQuestion('nebulizer itu buat apa ya?', '628805');
    expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(args4Of(spy)).toBe('Nebulizer');
  });

  it('6. "pijat lahap juara itu buat anak 3 bulan bisa ya?" (nama FULL disebut) → "Pijat Lahap Juara"', async () => {
    const spy = setupMockExpectations();
    const result = await runQuestion('pijat lahap juara itu buat anak 3 bulan bisa ya?', '628806');
    expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(args4Of(spy)).toBe('Pijat Lahap Juara');
  });
});

function args4Of(spy: ReturnType<typeof vi.spyOn>): unknown {
  expect(spy).toHaveBeenCalled();
  return spy.mock.calls[0][4];
}