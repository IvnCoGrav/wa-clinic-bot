import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isFunnelCommitted } from '../../../src/v3/agent/pipeline/phase-resolver';
import { GuardrailPipeline } from '../../../src/v3/agent/pipeline/guardrail-pipeline';
import { evaluateToolMasking } from '../../../src/v3/tools/tool-masker';
import { __clearMemorySessions } from '../../../src/v3/state/goal-tracker';
import type { CustomerGoalSession } from '../../../src/v3/domain/types';

/**
 * Fase C3 (Rencana Perbaikan Opsi C) — kunci komitmen tanpa tool.
 *
 * Kasus produksi (conv 62e60d13): LLM menilai customer COMMITTED tetapi TIDAK
 * memanggil tool -> selectedTreatment/cart kosong. Sebelum latch ada, funnel
 * menganggap belum komit dan MENGHAPUS pertanyaan jadwal yang sah.
 *
 * Kontrak yang dikunci test ini:
 *   1. Komitmen yang ditandai (bookingCommitConfirmed / lastCommitment='COMMITTED')
 *      membuat isFunnelCommitted() true MESKI tanpa selectedTreatment/cart.
 *   2. Bila committed, guardrail TIDAK menghapus pertanyaan jadwal (funnel reprompt off).
 *   3. TIDAK ada pelonggaran: tanpa komitmen, save_reservation tetap dicabut.
 */
describe('Fase C3 — komitmen tanpa tool tetap sah, funnel tidak hapus jadwal', () => {
  beforeEach(() => {
    __clearMemorySessions();
    vi.restoreAllMocks();
  });

  const committedByLatch = { genderGreeting: 'Bunda', bookingCommitConfirmed: true } as any;
  const committedByVerdict = { genderGreeting: 'Bunda', lastCommitment: 'COMMITTED' } as any;
  const notCommitted = { genderGreeting: 'Bunda', cartItems: [], selectedTreatment: null } as any;

  it('(1) isFunnelCommitted true lewat bookingCommitConfirmed tanpa treatment', () => {
    expect(isFunnelCommitted(committedByLatch)).toBe(true);
  });

  it('(1b) isFunnelCommitted true lewat lastCommitment=COMMITTED tanpa treatment', () => {
    expect(isFunnelCommitted(committedByVerdict)).toBe(true);
  });

  it('(1c) isFunnelCommitted false saat benar-benar belum komit', () => {
    expect(isFunnelCommitted(notCommitted)).toBe(false);
  });

  const runGuard = (session: CustomerGoalSession, draftReply: string) =>
    GuardrailPipeline.verifyAndReprompt({
      draftReply,
      incomingText: 'Boleh bun',
      isFollowUp: false,
      executedTools: [],
      retrievedChunks: [],
      session,
      tenantId: 'default-tenant',
      phone: '628123456789',
      conversationId: 'conv-c3',
      selectedModel: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      shouldSendReply: true,
      isEscalated: false,
      emptyKnowledgeResult: false,
      // Bila funnel reprompt keliru dijalankan, ia mengembalikan balasan TANPA
      // kata "jadwalkan" -> assertion (2) akan merah. Ini yang membuat test
      // benar-benar bisa mendeteksi regresi (bukan sekadar mock yang melempar).
      executeChat: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'Baik Bunda, apakah Bunda tertarik mencoba perawatan ini? 😊' } }],
        usage: {},
      }),
      recordCall: vi.fn(),
      addUsage: vi.fn(),
      auditUsage: vi.fn(),
    } as any);

  it('(2) committed: pertanyaan jadwal pada draf TIDAK dihapus', async () => {
    const draft = 'Baik Bunda, untuk *Pijat Pulih Ceria* kami bantu ya. Kira-kira mau kami bantu jadwalkan di hari apa ya?';
    const out = await runGuard(committedByLatch, draft);
    expect(out.finalReply).toContain('jadwalkan');
    expect(out.violationsDetected).not.toContain('FUNNEL_REPROMPT_APPLIED');
  });

  it('(3) no-loosening: tanpa komitmen, save_reservation tetap DICABUT', () => {
    const session = {
      genderGreeting: 'Bunda',
      selectedTreatment: 'Pijat Pulih Ceria',
      location: { rawText: 'Tenggilis', kelurahan: 'Tenggilis Mejoyo', kota: 'Surabaya' },
    } as CustomerGoalSession;
    const verdict = evaluateToolMasking(undefined as any, session, 'Selasa bu, tgl 18 agt');
    expect(verdict.isSaveReservationAllowed).toBe(false);
  });
});
