import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  router: vi.fn(),
  summarize: vi.fn(),
  callChat: vi.fn(),
  reservationFindMany: vi.fn(),
  conversationFindMany: vi.fn(),
  customerFindMany: vi.fn(),
  customerFindFirst: vi.fn(),
  clinicServiceFindMany: vi.fn(),
  knowledgeChunkFindMany: vi.fn(),
  clinicPolicyFindMany: vi.fn(),
}));

vi.mock('../../src/services/copilot/hermes-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/copilot/hermes-adapter')>();
  return {
    ...actual,
    requestHermesRouter: (...a: any[]) => h.router(...a),
    requestHermesSummarize: (...a: any[]) => h.summarize(...a),
  };
});

vi.mock('../../src/db/client', () => ({
  prisma: {
    reservation: { findMany: h.reservationFindMany },
    conversation: { findMany: h.conversationFindMany },
    customer: { findMany: h.customerFindMany, findFirst: h.customerFindFirst },
    clinicService: { findMany: h.clinicServiceFindMany },
    knowledgeChunk: { findMany: h.knowledgeChunkFindMany },
    clinicPolicy: { findMany: h.clinicPolicyFindMany },
  },
}));

vi.mock('../../src/integrations/llm/model-fallback', () => ({
  callChatCompletionsWithFallback: (...a: any[]) => h.callChat(...a),
}));

vi.mock('../../src/integrations/llm/llm-gateway', () => ({
  getLlmEndpointConfig: () => ({ model: 'test', fallbackModel: 'test', baseUrl: 'http://x', apiKey: 'k', timeoutMs: 1000 }),
}));

// Catatan seam: file ini me-mock hermes-adapter (uji wiring service).
// Kontrak HTTP adapter (fetch stub) diuji di `copilot-hermes-contract.test.ts`
// yang TIDAK me-mock modul tersebut (mock Vitest terisolasi per file).

import { copilotService } from '../../src/services/copilot/copilot.service';

function llmReply(content: string) {
  return { data: { choices: [{ message: { content } }] } };
}

function inboundConv() {
  return [
    {
      id: 'conv-1',
      customer: { id: 'u1', name: 'Bunda Rina', phone: '6285712345678' },
      messages: [{ direction: 'INBOUND', content: 'hai', created_at: new Date() }],
    },
  ];
}

describe('CopilotService + COPILOT_ENGINE=hermes (otak Hermes, tangan + satpam tetap Fastify)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    h.reservationFindMany.mockResolvedValue([]);
    h.conversationFindMany.mockResolvedValue([]);
    h.customerFindMany.mockResolvedValue([]);
    process.env.COPILOT_ENGINE = 'hermes';
    process.env.HERMES_BRIDGE_URL = 'http://hermes-agent:9119';
    process.env.HERMES_BRIDGE_SECRET = 's3cr3t';
  });
  afterEach(() => {
    delete process.env.COPILOT_ENGINE;
    delete process.env.HERMES_BRIDGE_URL;
    delete process.env.HERMES_BRIDGE_SECRET;
  });

  it('router Hermes dipakai; tool tetap dieksekusi di Fastify; grounding hidup', async () => {
    h.router
      .mockResolvedValueOnce({ tool: 'query_unreplied_chats', args: {} })
      .mockResolvedValueOnce({ tool: null, args: {} });
    h.summarize.mockResolvedValueOnce('Belum dibalas: Bunda Rina.');
    h.conversationFindMany.mockResolvedValue(inboundConv());
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'chat menggantung?' });
    expect(res.success).toBe(true);
    expect(res.toolsUsed).toEqual(['query_unreplied_chats']);
    expect(res.answer).toBe('Belum dibalas: Bunda Rina.');
    expect(res.grounded).toBe(true);
    // LLM internal TIDAK dipakai untuk router/summarize pada turn ini.
    expect(h.callChat).not.toHaveBeenCalled();
    expect(h.router).toHaveBeenCalled();
    expect(h.summarize).toHaveBeenCalled();
  });

  it('router Hermes gagal (null) → fallback ke router LLM internal', async () => {
    h.router.mockResolvedValueOnce(null);
    h.callChat
      .mockResolvedValueOnce(llmReply('{"tool":"query_unreplied_chats","args":{}}'))
      .mockResolvedValueOnce(llmReply('{"tool":null,"args":{}}'))
      .mockResolvedValueOnce(llmReply('Ringkasan internal.'));
    h.conversationFindMany.mockResolvedValue(inboundConv());
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'chat menggantung?' });
    expect(res.success).toBe(true);
    expect(res.answer).toBe('Ringkasan internal.');
    expect(h.callChat).toHaveBeenCalled();
  });

  it('summarize Hermes gagal → fallback ke summarize LLM internal (grounding tetap)', async () => {
    h.router
      .mockResolvedValueOnce({ tool: 'query_unreplied_chats', args: {} })
      .mockResolvedValueOnce({ tool: null, args: {} });
    h.summarize.mockResolvedValueOnce(null);
    h.callChat.mockResolvedValueOnce(llmReply('Ringkasan internal.'));
    h.conversationFindMany.mockResolvedValue(inboundConv());
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'chat menggantung?' });
    expect(res.success).toBe(true);
    expect(res.answer).toBe('Ringkasan internal.');
  });

  it('observability: engine=hermes tanpa fallback (jejak bukti Hermes bekerja)', async () => {
    h.router
      .mockResolvedValueOnce({ tool: 'query_unreplied_chats', args: {} })
      .mockResolvedValueOnce({ tool: null, args: {} });
    h.summarize.mockResolvedValueOnce('Belum dibalas: Bunda Rina.');
    h.conversationFindMany.mockResolvedValue(inboundConv());
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'chat menggantung?' });
    expect(res.engine).toBe('hermes');
    expect(res.hermesFallback).toBe(false);
  });

  it('observability: engine=hermes + fallback (BUKAN bukti Hermes bekerja)', async () => {
    h.router.mockResolvedValueOnce(null);
    h.callChat
      .mockResolvedValueOnce(llmReply('{"tool":"query_unreplied_chats","args":{}}'))
      .mockResolvedValueOnce(llmReply('{"tool":null,"args":{}}'))
      .mockResolvedValueOnce(llmReply('Ringkasan internal.'));
    h.conversationFindMany.mockResolvedValue(inboundConv());
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'chat menggantung?' });
    expect(res.engine).toBe('hermes');
    expect(res.hermesFallback).toBe(true);
  });

  it('simulasi skenario 1 (majemuk): 2 tool + 2 kelompok + link klik + engine hermes', async () => {
    // Skenario nyata: "Siapa saja yang minta besok? Baik yang sudah dan belum terjadwal"
    h.router
      .mockResolvedValueOnce({ tool: 'query_reservations_by_filter', args: { date: '2026-09-28' } })
      .mockResolvedValueOnce({ tool: 'query_stalled_inquiries', args: { date: 'besok' } })
      .mockResolvedValueOnce({ tool: null, args: {} });
    h.summarize.mockResolvedValueOnce(
      '**Sudah Terjadwal**\n- Bunda Dara — Baby Massage [Buka Chat](/admin/live-chat?conversationId=conv-1)\n\n' +
        '**Belum Masuk Sistem**\n- Bunda Dewi — minta besok [Buka Chat](/admin/live-chat?conversationId=conv-2)'
    );
    h.reservationFindMany.mockResolvedValue([
      {
        id: 'r1',
        customer: { id: 'c1', name: 'Bunda Dara', conversations: [{ id: 'conv-1' }] },
        treatment_detail: 'Baby Massage',
        booking_date: new Date('2026-09-28T02:00:00Z'),
        status: 'confirmed',
        assigned_staff: { name: 'Bidan Yusi' },
      },
    ]);
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv-2',
        session_data: null,
        last_discussed_treatment: null,
        customer: { id: 'c2', name: 'Bunda Dewi', phone: '6285712345678', reservations: [] },
        messages: [{ direction: 'INBOUND', content: 'minta besok bisa?', created_at: new Date(Date.now() - 60000) }],
      },
    ]);
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'Siapa saja yang minta besok? Baik yang sudah dan belum terjadwal' });
    expect(res.success).toBe(true);
    expect(res.toolsUsed).toEqual(['query_reservations_by_filter', 'query_stalled_inquiries']);
    expect(res.engine).toBe('hermes');
    expect(res.hermesFallback).toBe(false);
    expect(res.grounded).toBe(true);
    expect(res.answer).toContain('Sudah Terjadwal');
    expect(res.answer).toContain('Belum Masuk Sistem');
    expect(res.answer).toContain('/admin/live-chat?conversationId=conv-1');
    expect(res.answer).toContain('/admin/live-chat?conversationId=conv-2');
    expect(res.rowCounts).toEqual({ query_reservations_by_filter: 1, query_stalled_inquiries: 1 });
  });

  it('observability: engine internal default', async () => {
    delete process.env.COPILOT_ENGINE;
    h.callChat
      .mockResolvedValueOnce(llmReply('{"tool":"query_unreplied_chats","args":{}}'))
      .mockResolvedValueOnce(llmReply('{"tool":null,"args":{}}'))
      .mockResolvedValueOnce(llmReply('Ringkasan rapi.'));
    h.conversationFindMany.mockResolvedValue(inboundConv());
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'chat menggantung?' });
    expect(res.engine).toBe('internal');
    expect(res.hermesFallback).toBe(false);
  });

  it('engine internal (default) → adapter Hermes TIDAK disentuh', async () => {
    delete process.env.COPILOT_ENGINE;
    h.callChat
      .mockResolvedValueOnce(llmReply('{"tool":"query_unreplied_chats","args":{}}'))
      .mockResolvedValueOnce(llmReply('{"tool":null,"args":{}}'))
      .mockResolvedValueOnce(llmReply('Ringkasan rapi.'));
    h.conversationFindMany.mockResolvedValue(inboundConv());
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'chat menggantung?' });
    expect(res.answer).toBe('Ringkasan rapi.');
    expect(h.router).not.toHaveBeenCalled();
    expect(h.summarize).not.toHaveBeenCalled();
  });
});
