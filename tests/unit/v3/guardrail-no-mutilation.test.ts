import { describe, it, expect, vi } from 'vitest';
import { GuardrailPipeline } from '../../../src/v3/agent/pipeline/guardrail-pipeline';

describe('GuardrailPipeline Anti-Mutilation (T0.2)', () => {
  const baseSession = {
    genderGreeting: 'Bunda',
    location: null,
    selectedTreatment: null,
    cartItems: [],
  } as any;

  it('Anti-mutilasi: pertanyaan usia pada balasan tidak dimutilasi/dipotong paksa oleh regex bila reprompt gagal', async () => {
    const draftReply = 'Untuk jadwalnya kami siap bantu Bunda. Usia si kecil berapa bulan ya Bund?';
    const mockExecuteChat = vi.fn().mockRejectedValue(new Error('Reprompt failed'));

    const out = await GuardrailPipeline.verifyAndReprompt({
      draftReply,
      incomingText: 'Bisa jadwal hari rabu besok?',
      isFollowUp: true,
      executedTools: [],
      retrievedChunks: [],
      session: baseSession,
      tenantId: 'default-tenant',
      phone: '628123456789',
      conversationId: 'conv-test-1',
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

    // Balasan asli harus tetap utuh, tidak terpotong cacat di tengah kalimat
    expect(out.finalReply).toBe(draftReply);
    expect(out.violationsDetected).toContain('age_solicitation_unresolved');
    expect(out.shouldSendReply).toBe(true);
  });

  it('SESI 783810: menodong usia NOMINAL tanpa otorisasi klinis → strip deterministik angka (bukan mutilasi kata)', async () => {
    const draftReply = 'Bunda, untuk rekomendasi yang tepat kami perlu tahu usia si kecil 3 bulan anaknya.';
    const mockExecuteChat = vi.fn().mockRejectedValue(new Error('Reprompt failed'));

    const out = await GuardrailPipeline.verifyAndReprompt({
      draftReply,
      incomingText: 'Anak saya batuk pilek terus',
      isFollowUp: true,
      executedTools: [],
      retrievedChunks: [],
      session: baseSession,
      tenantId: 'default-tenant',
      phone: '628123456789',
      conversationId: 'conv-test-1',
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

    // Hanya klausa nominal usia yang di-kolom-kan; kalimat tidak dimutilasi.
    expect(out.finalReply).not.toMatch(/3\s*bulan/);
    expect(out.finalReply).toContain('usia si kecil');
    expect(out.violationsDetected).toContain('nominal_age_solicitation_stripped');
    expect(out.shouldSendReply).toBe(true);
  });

  it('SESI 783810: otorisasi needsAgeClarification (tool katalog) → angka usia TETAP dipertahankan (SOP klinis disetujui)', async () => {
    const draftReply = 'Bunda, untuk rekomendasi yang tepat kami perlu tahu usia si kecil 3 bulan anaknya.';
    const out = await GuardrailPipeline.verifyAndReprompt({
      draftReply,
      incomingText: 'Anak saya batuk pilek terus',
      isFollowUp: true,
      executedTools: [{ name: 'get_catalog_and_price', result: { needsAgeClarification: true } }],
      retrievedChunks: [],
      session: baseSession,
      tenantId: 'default-tenant',
      phone: '628123456789',
      conversationId: 'conv-test-2',
      selectedModel: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      shouldSendReply: true,
      isEscalated: false,
      emptyKnowledgeResult: false,
      executeChat: vi.fn(),
      recordCall: vi.fn(),
      addUsage: vi.fn(),
      auditUsage: vi.fn(),
    });

    expect(out.finalReply).toContain('3 bulan');
    expect(out.violationsDetected).not.toContain('nominal_age_solicitation_stripped');
  });

  it('SESI 783810: angka usia TANPA kata "usia" (bukan todongan nominal) → TIDAK di-strip', async () => {
    const draftReply = 'Si kecil 3 bulan kok pilek ya Bunda, wajar jika batuk sedikit.';
    const out = await GuardrailPipeline.verifyAndReprompt({
      draftReply,
      incomingText: 'Anak saya batuk pilek terus',
      isFollowUp: true,
      executedTools: [],
      retrievedChunks: [],
      session: baseSession,
      tenantId: 'default-tenant',
      phone: '628123456789',
      conversationId: 'conv-test-3',
      selectedModel: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      shouldSendReply: true,
      isEscalated: false,
      emptyKnowledgeResult: false,
      executeChat: vi.fn(),
      recordCall: vi.fn(),
      addUsage: vi.fn(),
      auditUsage: vi.fn(),
    });

    expect(out.finalReply).toBe(draftReply);
    expect(out.violationsDetected).not.toContain('nominal_age_solicitation_stripped');
  });

  it('SESI 662917: anjuran share location terdeteksi → re-prompt bersih diterapkan (validator 7f)', async () => {
    const draftReply = 'Untuk area Kecamatan Wonokromo, kalau boleh tau rumah Bunda di kelurahan mana ya? Atau jika berkenan mungkin bisa kirim share location-nya Bunda 😊🙏';
    const cleaned = 'Untuk area Kecamatan Wonokromo, kalau boleh tau rumah Bunda di kelurahan mana ya? 😊';
    const mockExecuteChat = vi.fn().mockResolvedValue({
      choices: [{ message: { content: cleaned } }],
    });

    const out = await GuardrailPipeline.verifyAndReprompt({
      draftReply,
      incomingText: 'Daerah Wonokromo',
      isFollowUp: true,
      executedTools: [],
      retrievedChunks: [],
      session: baseSession,
      tenantId: 'default-tenant',
      phone: '628123456789',
      conversationId: 'conv-test-1',
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

    expect(out.violationsDetected).toContain('shareloc_solicitation_detected');
    expect(out.finalReply).not.toMatch(/share\s*loc(?:ation|k)?|sharelock/i);
    expect(out.finalReply).toContain('kelurahan mana ya');
  });

  it('SESI 662917: re-prompt gagal → balasan asli dipertahankan + dicatat unresolved (anti-mutilasi)', async () => {
    const draftReply = 'Boleh Bunda, kalau berkenan bisa sekalian kirim shareloc nya ya biar titiknya presisi 🙏';
    const mockExecuteChat = vi.fn().mockRejectedValue(new Error('Reprompt failed'));

    const out = await GuardrailPipeline.verifyAndReprompt({
      draftReply,
      incomingText: 'Daerah Wonokromo',
      isFollowUp: true,
      executedTools: [],
      retrievedChunks: [],
      session: baseSession,
      tenantId: 'default-tenant',
      phone: '628123456789',
      conversationId: 'conv-test-1',
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

    expect(out.finalReply).toBe(draftReply);
    expect(out.violationsDetected).toContain('shareloc_solicitation_unresolved');
    expect(out.shouldSendReply).toBe(true);
  });
});
