import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationState } from '@prisma/client';
import { validateFactualClaims } from '../../src/v3/guardrails/factual-claim-validator';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { GenerationStage } from '../../src/v3/agent/pipeline/generation-stage';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Fase D — Validator klaim faktual non-angka (D1..D5).
 * Gagal setelah re-prompt 1x → SUNYI TOTAL + eskalasi unresolved_faq.
 */
describe('Factual claim validator', () => {
  const catalogTools = (names: string[], durations: number[]) => [{
    name: 'get_catalog_and_price',
    args: {},
    result: {
      success: true,
      treatments: names.map((n, i) => ({ name: n, durationMinutes: durations[i] ?? 60 })),
    },
  }];
  const knowledgeTools = (chunks: any[]) => [{
    name: 'search_knowledge_faq', args: {}, result: { success: true, chunks },
  }];
  const policyTools = () => [{ name: 'get_clinic_policy_faq', args: {}, result: { success: true } }];

  it('D1: nama layanan karangan di-bold → invalid; yang ada di katalog → valid', () => {
    const tools = catalogTools(['Pijat Laktasi', 'Pijat Bayi Ceria'], [60, 45]);
    const bad = validateFactualClaims('Bisa ambil *Pijat Laktasi Premium* ya Bunda 😊', tools);
    expect(bad.isValid).toBe(false);
    expect(bad.violations.join(' ')).toMatch(/Pijat Laktasi Premium/);
    const good = validateFactualClaims('Bisa ambil *Pijat Laktasi* ya Bunda 😊', tools);
    expect(good.isValid).toBe(true);
  });

  it('D1: bold generik ("promo", "jadwal") tidak ditandai', () => {
    const tools = catalogTools(['Pijat Laktasi'], [60]);
    expect(validateFactualClaims('Lihat *promo* dan *jadwal* kami ya', tools).isValid).toBe(true);
  });

  it('D2: bahas vaksin tanpa tool kebijakan → invalid; dengan tool → valid', () => {
    expect(validateFactualClaims('Habis vaksin boleh langsung pijat ya Bunda', []).isValid).toBe(false);
    expect(validateFactualClaims('Habis vaksin boleh langsung pijat ya Bunda', policyTools()).isValid).toBe(true);
  });

  it('D3: anjuran SOP tanpa artikel → invalid; dengan chunks → valid', () => {
    const text = 'Sebaiknya bayi dimandikan dengan air hangat setiap hari agar tidak rewel dan tidurnya nyenyak ya Bunda';
    expect(validateFactualClaims(text, []).isValid).toBe(false);
    expect(validateFactualClaims(text, knowledgeTools([{ id: '1', content: 'mandi air hangat' }])).isValid).toBe(true);
  });

  it('D4: durasi tekstual beda katalog → invalid; cocok → valid', () => {
    const tools = catalogTools(['Pijat Bayi Ceria'], [30]);
    expect(validateFactualClaims('Durasinya 45 menit ya Bunda', tools).isValid).toBe(false);
    expect(validateFactualClaims('Durasinya 30 menit ya Bunda', tools).isValid).toBe(true);
  });

  it('D5: klaim absolut → invalid; balasan normal → valid', () => {
    expect(validateFactualClaims('Pijat ini dijamin menyembuhkan batuk si kecil', []).isValid).toBe(false);
    expect(validateFactualClaims('Pijat ini membantu meredakan batuk si kecil ya Bunda', []).isValid).toBe(true);
  });

  it('D6: "Area Kecamatan Waru" tanpa lokasi sesi → invalid (kasus simulator 725870)', () => {
    const text = 'Area Kecamatan Waru ini masih cukup luas. Kalau boleh tahu, rumah Bunda di kelurahan mana ya?';
    const bad = validateFactualClaims(text, [], [], { locationKnown: false });
    expect(bad.isValid).toBe(false);
    expect(bad.violations.join(' ')).toMatch(/Domicile/i);
  });

  it('D6: fakta homebase dikecualikan; lokasi dikenal dilewati; kecamatan fiktif di luar cakupan', () => {
    const homebase = 'Homebase kami ada di Waru, Sidoarjo ya Bunda. Kalau boleh tahu rumah Bunda di daerah mana ya?';
    expect(validateFactualClaims(homebase, [], [], { locationKnown: false }).isValid).toBe(true);
    const known = 'Area Kecamatan Waru ini masih cukup luas ya Bunda';
    expect(validateFactualClaims(known, [], [], { locationKnown: true }).isValid).toBe(true);
    const fiktif = 'Area Kecamatan Ngalor Kidul ini masih cukup luas ya Bunda';
    expect(validateFactualClaims(fiktif, [], [], { locationKnown: false }).isValid).toBe(true);
  });

  it('D5 integrasi: klaim absolut lolos re-prompt → SUNYI TOTAL + unresolved_faq', async () => {
    const sentToCustomer: string[] = [];
    const sm = new ConversationStateMachine({
      simulateHumanReply: async (params: any) => {
        sentToCustomer.push(params.replyText);
        return { success: true };
      },
    } as any);
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    vi.restoreAllMocks();

    // LLM selalu mengarang klaim absolut — Call-1 maupun re-prompt.
    vi.spyOn(GenerationStage, 'executeChatCompletion').mockResolvedValue({
      choices: [{ message: { content: 'Tenang Bunda, treatment kami dijamin menyembuhkan batuk pilek si kecil tanpa efek samping sama sekali.' } }],
    } as any);

    const phone = `62890${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Faktual', DEFAULT_TENANT_ID);
    const result = await sm.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_fd_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'anak saya batuk pilek' },
      },
    });

    expect(result.shouldSendReply).toBe(false);
    expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(sentToCustomer.length).toBe(0);
    const updated = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(updated.is_human_handling).toBe(true);
    expect(updated.escalation_reason).toBe('unresolved_faq');
  });
});
