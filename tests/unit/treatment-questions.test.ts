import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { stateMachine } from '../../src/state-machine/machine';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { knowledgeBaseService } from '../../src/services/knowledge.service';
import { llmResponseGenerator } from '../../src/integrations/llm/generator';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import { NluClassifierService } from '../../src/services/nlu-classifier.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Test treatment question handling — bagaimana sistem menanggapi
 * pertanyaan customer terkait treatment (harga, manfaat, rekomendasi, dll).
 */

function mockKnowledge() {
  return vi.spyOn(knowledgeBaseService, 'searchRelevantChunks').mockResolvedValue([
    {
      id: 'chunk-pijat-bayi',
      tenantId: DEFAULT_TENANT_ID,
      sourceType: 'faq',
      title: 'Pijat Bayi Ceria',
      content: `Pertanyaan: Pijat bayi itu manfaatnya apa?
Jawaban: Pijat Bayi Ceria membantu bayi tidur lebih nyenyak, mengurangi kelelahan, dan membuat tubuh bayi lebih rileks. Harga promo Rp60.000, durasi 40 menit.`,
      documentName: 'faq',
    },
  ]);
}

function mockGenerator() {
  return vi.spyOn(llmResponseGenerator, 'generateFaqResponse').mockResolvedValue(
    'Pijat Bayi Ceria membantu bayi tidur lebih nyenyak dan rileks. Promo Rp60.000 selama 40 menit. 😊'
  );
}

describe('Treatment Questions — NLU Intent Classification', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'mock_key';
    vi.restoreAllMocks();
  });

  const treatmentQuestions = [
    { text: 'pijat bayi berapa ya', expected: 'ask_price' },
    { text: 'harga treatment nya berapa', expected: 'ask_price' },
    { text: 'pijat bayi itu buat apa', expected: 'faq_question' },
    { text: 'manfaat pijat bayi apa saja', expected: 'faq_question' },
    { text: 'ada treatment buat anak pilek ga?', expected: 'faq_question' },
    { text: 'mau booking pijat bayi', expected: 'express_interest' },
    { text: 'saya mau pijat hamil dong', expected: 'express_interest' },
    { text: 'nebulizer buat bayi boleh gak', expected: 'faq_question' },
    { text: 'pijat laktasi itu buat apa', expected: 'faq_question' },
    { text: 'tindik telinga bayi berapa', expected: 'ask_price' },
  ];

  treatmentQuestions.forEach((tc, i) => {
    it(`NLU #${i + 1}: "${tc.text}" → harus ada intent ${tc.expected}`, async () => {
      const result = await NluClassifierService.classifyMessage(tc.text);
      expect(result.intents).toContain(tc.expected);
    });
  });
});

describe('Treatment Questions — Treatment Catalog Lookup', () => {
  it('katalog memuat layanan bapil/batuk (Pijat Bayi Pulih Ceria)', () => {
    const all = treatmentCatalogService.getAllServices(false);
    const bapilService = all.find(s => s.description.toLowerCase().includes('pilek') || s.description.toLowerCase().includes('batuk'));
    expect(bapilService).toBeDefined();
  });

  it('katalog memuat layanan neonatus (Paket Selapan / Newborn Care)', () => {
    const all = treatmentCatalogService.getAllServices(false);
    expect(all.some(s => s.id === 'baby-paket-selapan')).toBe(true);
  });

  it('filter kategori MOMS mengembalikan layanan ibu (prenatal, oksitosin, laktasi)', () => {
    const moms = treatmentCatalogService.getServicesByCategory('MOMS');
    expect(moms.length).toBeGreaterThan(3);
    expect(moms.every(s => s.category === 'MOMS' || s.category === 'BOTH')).toBe(true);
  });

  it('filter usia: bayi 5 bulan mendapat layanan baby tapi bukan kids', () => {
    const services = treatmentCatalogService.getServicesByAge(5);
    expect(services.some(s => s.id === 'baby-massage-ceria')).toBe(true);
    expect(services.some(s => s.id === 'kids-massage-ceria')).toBe(false);
  });

  it('formatCatalogText berisi nama treatment, harga, dan durasi', () => {
    const text = treatmentCatalogService.formatCatalogText();
    expect(text).toContain('Pijat Bayi Ceria');
    expect(text).toContain('Harga Normal');
    expect(text).toContain('Promo');
    expect(text).toContain('Durasi');
  });

  it('formatCatalogText(false) — mode konteks LLM TANPA harga', () => {
    const text = treatmentCatalogService.formatCatalogText(false);
    expect(text).toContain('Pijat Bayi Ceria');
    expect(text).toContain('Durasi');
    expect(text).toContain('Deskripsi');
    // Harga tidak boleh bocor ke konteks LLM
    expect(text).not.toContain('Harga Normal');
    expect(text).not.toContain('Promo');
    expect(text).not.toMatch(/Rp\s?\d/);
  });

  it('formatCatalogText(false) tetap memuat deskripsi bapil & moksa untuk konteks LLM', () => {
    const text = treatmentCatalogService.formatCatalogText(false);
    expect(text).toContain('Pijat Bayi Pulih Ceria');
    expect(text).toContain('Sinar Moksa');
    expect(text).toContain('Nebulizer');
  });
});

describe('Treatment Questions — State Machine Response (faq_question)', () => {
  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    vi.restoreAllMocks();
  });

  async function setupCustomer(state: ConversationState, phonePrefix: string) {
    const phone = `${phonePrefix}${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Test Treatment', DEFAULT_TENANT_ID);
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

  it('1. faq_question dengan KB match → jawab FAQ + tetap di AWAITING_INTEREST', async () => {
    mockKnowledge();
    mockGenerator();
    const { phone, customer } = await setupCustomer(ConversationState.AWAITING_INTEREST, '62871');

    const result = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_faq_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'pijat bayi itu buat apa ya?' },
      },
    });

    expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(result.shouldSendReply).toBe(true);
    expect(result.replyText).toContain('Pijat Bayi Ceria');
  });

  it('2. ask_price saat AWAITING_INTEREST → jawab info harga (mapping ke faq_question)', async () => {
    mockKnowledge();
    mockGenerator();
    const { phone, customer } = await setupCustomer(ConversationState.AWAITING_INTEREST, '62872');

    const result = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_price_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'pijat bayi berapa ya bunda?' },
      },
    });

    expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(result.shouldSendReply).toBe(true);
  });

  it('3. faq_question TANPA KB match → inject katalog treatment, jawab dari data treatment', async () => {
    vi.spyOn(knowledgeBaseService, 'searchRelevantChunks').mockResolvedValue([]);
    mockGenerator();
    const { phone, customer } = await setupCustomer(ConversationState.AWAITING_INTEREST, '62873');

    const result = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_catalog_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'moksa itu buat apa ya?' },
      },
    });

    // Tidak eskalasi senyap — tetap jawab dari katalog treatment
    expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(result.shouldSendReply).toBe(true);
  });

  it('3b. faq_question TANPA KB match DAN katalog kosong → tetap eskalasi senyap', async () => {
    vi.spyOn(knowledgeBaseService, 'searchRelevantChunks').mockResolvedValue([]);
    vi.spyOn(treatmentCatalogService, 'searchCatalogItems').mockReturnValue([]);
    vi.spyOn(treatmentCatalogService, 'getAllServices').mockReturnValue([]);
    const { phone, customer } = await setupCustomer(ConversationState.AWAITING_INTEREST, '62873');

    const result = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_nokb_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'treatment paling langka yang pernah ada apa ya?' },
      },
    });

    expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(result.isHumanHandling).toBe(true);
  });

  it('4. express_interest dengan lokasi tersimpan → kirim form reservasi', async () => {
    const { phone, customer } = await setupCustomer(ConversationState.AWAITING_INTEREST, '62874');

    const result = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_int_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'mau booking pijat bayi dong' },
      },
    });

    expect(result.nextState).toBe(ConversationState.RESERVATION_SENT);
    expect(result.replyText).toContain('list untuk reservasi');
  });

  it('5. express_interest TANPA lokasi → minta lokasi dulu', async () => {
    const phone = `62875${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Test NoLoc', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      { currentState: ConversationState.AWAITING_INTEREST, isHumanHandling: false },
      DEFAULT_TENANT_ID
    );

    const result = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_int_noloc_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'mau pijat hamil dong' },
      },
    });

    expect(result.nextState).toBe(ConversationState.AWAITING_LOCATION);
    expect(result.replyText).toMatch(/lokasi|kelurahan|share location/i);
  });

  it('6. mixed-signal "iya mau tapi bukan itu" → minta klarifikasi, bukan lanjut', async () => {
    const { phone, customer } = await setupCustomer(ConversationState.AWAITING_INTEREST, '62876');

    const result = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_mixed_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'iya mau tapi bukan pijat biasa' },
      },
    });

    expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(result.replyText).toContain('kurang tepat');
  });
});

describe('Treatment Questions — Pilihan Treatment untuk Kondisi Bayi', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'mock_key';
    vi.restoreAllMocks();
  });

  it('bayi 3 bulan dengan bapil → katalog punya Pijat Bayi Pulih Ceria + add-on nebulizer/moksa', () => {
    const babyServices = treatmentCatalogService.getServicesByAge(3);
    const ids = babyServices.map(s => s.id);
    expect(ids).toContain('baby-massage-pulih-ceria');
    expect(ids).toContain('add-on-nebulizer');
    expect(ids).toContain('add-on-sinar-moksa');
  });

  it('bayi newborn 20 hari → dapat Paket Selapan tapi bukan Kids', () => {
    const newborn = treatmentCatalogService.getServicesByAge(0);
    expect(newborn.some(s => s.id === 'baby-paket-selapan')).toBe(true);
    expect(newborn.some(s => s.id === 'kids-massage-ceria')).toBe(false);
  });

  it('anak 3 tahun → dapat Pijat Kids, bukan Pijat Bayi', () => {
    const toddler = treatmentCatalogService.getServicesByAge(36);
    expect(toddler.some(s => s.id === 'kids-massage-ceria')).toBe(true);
    expect(toddler.some(s => s.id === 'baby-massage-ceria')).toBe(false);
  });

  it('layanan MOMS tidak muncul di filter usia bayi', () => {
    const baby = treatmentCatalogService.getServicesByAge(6);
    expect(baby.some(s => s.category === 'MOMS')).toBe(false);
  });
});
