import { describe, it, expect, vi } from 'vitest';
import { GuardrailPipeline } from '../../../src/v3/agent/pipeline/guardrail-pipeline';

/**
 * CASE-015 regresi: saat draf Call-2 kosong (DSML terlucuti) namun katalog
 * turn ini SUDAH dipanggil tanpa specificTreatmentName/symptoms eksplisit,
 * recovery HARUS memakai treatments[0] — bukan kaleng buntu "Kami pastikan
 * informasinya...".
 */
describe('GuardrailPipeline — recovery katalog tanpa explicit intent (CASE-015)', () => {
  const baseInput = (overrides: any = {}) => ({
    draftReply: '',
    incomingText: 'Bayi saya baru saja selapan klo yg treatment sekalian cukur bayi blm ada ya',
    isFollowUp: true,
    executedTools: [] as any[],
    retrievedChunks: [] as any[],
    session: { cartItems: [] } as any,
    tenantId: 'default-tenant',
    phone: '6281',
    conversationId: 'conv-gp-015',
    selectedModel: 'mock-model',
    baseUrl: 'https://mock.test/v1',
    apiKey: 'k',
    shouldSendReply: true,
    isEscalated: false,
    emptyKnowledgeResult: false,
    executeChat: vi.fn(),
    recordCall: vi.fn(),
    addUsage: vi.fn(),
    auditUsage: vi.fn(),
    ...overrides,
  });

  it('draf kosong + catalogTool tanpa explicit intent → pakai treatments[0], bukan buntu', async () => {
    const out = await GuardrailPipeline.verifyAndReprompt(baseInput({
      draftReply: '',
      executedTools: [{
        name: 'get_catalog_and_price',
        args: { commitment: 'EXPLORING' },
        result: { treatments: [{ name: 'Kala Bundle Selapan – Cukur + Pijat Ceria', category: 'BABY', description: 'Paket selapanan.' }] },
      }],
    }));
    expect(out.finalReply).not.toMatch(/kami pastikan informasinya/i);
    expect(out.finalReply).toContain('Selapan');
  });
});
