import { describe, it, expect, vi } from 'vitest';
import { GuardrailPipeline } from '../../src/v3/agent/pipeline/guardrail-pipeline';
import { countDistinctPrimaryOffers } from '../../src/v3/state/cart-manager';

/**
 * Audit 6285743192813 / Phase 3 — CTA penutup state-aware.
 *
 * Akar: saat reprompt (usia), CTA jadwal ("hari apa") disuntikkan padahal draf
 * masih menyodorkan ≥2 pilihan paket → customer dipaksa menjawab hari sebelum
 * memilih. Fix: gerbang kode deterministik berbasis matcher katalog (bukan regex
 * penomoran "1. 2."). Keranjang kosong + ≥2 PRIMARY → ajak memilih paket.
 */
describe('countDistinctPrimaryOffers (pure, data-driven)', () => {
  const catalog = [
    { name: 'Kala Baby - Pijat Ceria Newborn', category: 'BABY', isAddon: false },
    { name: 'Kala Baby - Pijat Pulih Ceria', category: 'BABY', isAddon: false },
    { name: 'Kala Baby - Sinar Moksa', category: 'ADDON', isAddon: true },
  ];

  it('menghitung 2 opsi PRIMARY berbeda', () => {
    const text = 'Ada 2 pilihan: Kala Baby - Pijat Ceria Newborn atau Kala Baby - Pijat Pulih Ceria.';
    expect(countDistinctPrimaryOffers(text, catalog)).toBe(2);
  });

  it('satu opsi → 1; ADDON tidak dihitung', () => {
    expect(countDistinctPrimaryOffers('Kami sarankan Kala Baby - Pijat Ceria Newborn.', catalog)).toBe(1);
    expect(countDistinctPrimaryOffers('Tambahan Kala Baby - Sinar Moksa ya.', catalog)).toBe(0);
  });

  it('tanpa nama katalog → 0 (tanpa phantom)', () => {
    expect(countDistinctPrimaryOffers('Baik Bunda, kami bantu jadwalkan ya.', catalog)).toBe(0);
  });
});

describe('GuardrailPipeline reprompt CTA multi-opsi (audit 6285743192813)', () => {
  const baseSession: any = {
    genderGreeting: 'Bunda', location: null, selectedTreatment: null, cartItems: [],
  };

  it('draf 2 opsi paket → CTA ajak memilih, BUKAN tanya hari', async () => {
    const draftReply = 'Untuk si kecil usia berapa ya Bunda? Ada 2 pilihan: Kala Baby - Pijat Ceria Newborn atau Kala Baby - Pijat Pulih Ceria.';
    const rewrite = 'Berikut pilihan untuk si kecil: Kala Baby - Pijat Ceria Newborn atau Kala Baby - Pijat Pulih Ceria ya Bunda.';
    const mockExecuteChat = vi.fn().mockResolvedValue({ choices: [{ message: { content: rewrite } }] });

    const out = await GuardrailPipeline.verifyAndReprompt({
      draftReply,
      incomingText: 'Anak saya rewel terus gimana ya',
      isFollowUp: true,
      executedTools: [],
      retrievedChunks: [],
      session: baseSession,
      tenantId: 'default-tenant',
      phone: '628123456789',
      conversationId: 'conv-cta-1',
      selectedModel: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      shouldSendReply: true,
      isEscalated: false,
      emptyKnowledgeResult: false,
      executeChat: mockExecuteChat,
      recordCall: vi.fn(),
      addUsage: vi.fn(),
      auditUsage: vi.fn(),
    });

    expect(out.finalReply).toContain('lebih cocok dengan pilihan yang mana');
    expect(out.finalReply).not.toMatch(/di hari apa/i);
  });
});
