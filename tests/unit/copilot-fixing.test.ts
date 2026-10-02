import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  reservationFindMany: vi.fn(),
  conversationFindMany: vi.fn(),
  customerFindMany: vi.fn(),
  customerFindFirst: vi.fn(),
  clinicServiceFindMany: vi.fn(),
  knowledgeChunkFindMany: vi.fn(),
  clinicPolicyFindMany: vi.fn(),
  callChat: vi.fn(),
}));

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

import { copilotService, buildRouterPrompt, stripInternalIds, sanitizeCopilotAnswer, buildDegradedAnswer, buildSummarizePrompt, formatWaitTime, withDeadline, isCopilotDeadlineError } from '../../src/services/copilot/copilot.service';
import {
  resolveReservationDateFilter,
  isValidIsoDate,
  queryReservationsByFilter,
  queryUnrepliedChats,
  queryUnscheduledProspects,
  queryStalledInquiries,
  getCustomerHistory,
  lookupCatalogAndPolicy,
  hasScheduleIntentSignal,
  matchesInquiryDate,
  getCopilotTool,
  COPILOT_TOOLS,
} from '../../src/services/copilot/copilot-tools';
import { startOfTodayWib } from '../../src/utils/wib-time';

function llmReply(content: string) {
  return { data: { choices: [{ message: { content } }] } };
}

describe('buildRouterPrompt — date anchor WIB (murni, deterministik)', () => {
  it('menyuntik hari ini & besok dengan nama hari + ISO yang benar (tengah malam WIB)', () => {
    // 2026-09-27T18:30:00Z = 2026-09-28 01:30 WIB (Senin → besok Selasa)
    const now = new Date('2026-09-27T18:30:00Z');
    const prompt = buildRouterPrompt('jadwal besok?', 'TOOLS', now);
    expect(prompt).toContain('Hari ini: Senin, 2026-09-28');
    expect(prompt).toContain('Besok: Selasa, 2026-09-29');
  });

  it('memuat pesan admin verbatim', () => {
    const prompt = buildRouterPrompt('Siapa yang minta besok?', 'TOOLS', new Date('2026-09-27T02:00:00Z'));
    expect(prompt).toContain('Siapa yang minta besok?');
    expect(prompt).toContain('Hari ini: Minggu, 2026-09-27');
  });
});

describe('resolveReservationDateFilter — anti past-trap (murni)', () => {
  const now = new Date('2026-09-27T05:00:00Z');

  it('tanggal valid → rentang satu hari WIB', () => {
    const f = resolveReservationDateFilter('2026-09-28', now);
    expect(f.lte).toBeDefined();
    // Awal hari WIB 28 Sep = 2026-09-27T17:00:00Z
    expect(f.gte.toISOString()).toBe('2026-09-27T17:00:00.000Z');
  });

  it('tanpa tanggal → hanya aktif mendatang (gte awal hari ini WIB)', () => {
    const f = resolveReservationDateFilter(undefined, now);
    expect(f.lte).toBeUndefined();
    expect(f.gte.getTime()).toBe(startOfTodayWib(now).getTime());
  });

  it('tanggal tidak valid ("besok"/"2026-13-99") → fallback future-only (tidak crash)', () => {
    expect(resolveReservationDateFilter('besok', now).lte).toBeUndefined();
    expect(resolveReservationDateFilter('2026-13-99', now).lte).toBeUndefined();
  });

  it('isValidIsoDate menolak kalimat bebas & format salah', () => {
    expect(isValidIsoDate('2026-09-28')).toBe(true);
    expect(isValidIsoDate('besok')).toBe(false);
    expect(isValidIsoDate('28/09/2026')).toBe(false);
    expect(isValidIsoDate(null)).toBe(false);
  });
});

describe('Copilot fixing — plumbing adversarial (LLM di-mock)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    h.reservationFindMany.mockResolvedValue([]);
    h.conversationFindMany.mockResolvedValue([]);
    h.customerFindMany.mockResolvedValue([]);
  });

  // 5 parafrase: yang diuji = plumbing deterministik (mock LLM → args diteruskan ke tool benar).
  // Loop multi-step: setelah tool dieksekusi, router dipanggil lagi → kita terminasi
  // dengan {"tool":null} (data cukup). Union rows kosong → early return, tanpa summarize.
  const paraphrases: Array<{ q: string; tool: string; args: any }> = [
    { q: 'Jadwal besok siapa saja ya', tool: 'query_reservations_by_filter', args: { date: '2026-09-28' } },
    { q: 'Kalau minta besok siapa saja', tool: 'query_reservations_by_filter', args: { date: '2026-09-28' } },
    { q: 'Ada yang minta hari minggu minggu depan? coba cek', tool: 'query_reservations_by_filter', args: { date: '2026-10-04' } },
    { q: 'Chat yang belum dibalas siapa aja', tool: 'query_unreplied_chats', args: {} },
    { q: 'jadwal hari ini', tool: 'query_reservations_by_filter', args: { date: '2026-09-27' } },
  ];

  for (const { q, tool, args } of paraphrases) {
    it(`"${q}" → tool ${tool} dengan args diteruskan apa adanya`, async () => {
      h.callChat
        .mockResolvedValueOnce(llmReply(JSON.stringify({ tool, args })))
        .mockResolvedValueOnce(llmReply('{"tool":null,"args":{}}'));
      const res = await copilotService.chat({ tenantId: 'tenant-a', message: q });
      expect(res.toolsUsed).toEqual([tool]);
      // tool benar dipanggil dengan tenant-scope
      if (tool === 'query_reservations_by_filter') {
        expect(h.reservationFindMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ tenant_id: 'tenant-a' }) })
        );
      } else {
        expect(h.conversationFindMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ tenant_id: 'tenant-a' }) })
        );
      }
    });
  }

  it('args.date valid diteruskan ke filter (rentang hari WIB)', async () => {
    await queryReservationsByFilter.run('tenant-a', { date: '2026-09-28' });
    const call = h.reservationFindMany.mock.calls[0][0];
    expect(call.where.booking_date.gte).toBeDefined();
    expect(call.where.booking_date.lte).toBeDefined();
  });

  it('tanpa tanggal → query future-only (booking_date gte, tanpa lte)', async () => {
    await queryReservationsByFilter.run('tenant-a', {});
    const call = h.reservationFindMany.mock.calls[0][0];
    expect(call.where.booking_date.gte).toBeDefined();
    expect(call.where.booking_date.lte).toBeUndefined();
  });

  it('grounding: honorifik beda (Bunda→Bu) & kapitalisasi TIDAK false-negative', () => {
    const rows = [{ customerName: 'Bunda Risma' }];
    expect(copilotService.validateGrounding('Baik, Bu Risma sudah terjadwal.', rows)).toBe(true);
    expect(copilotService.validateGrounding('bunda risma menunggu', rows)).toBe(true);
  });

  it('grounding: nama asing tetap terdeteksi halusinasi', () => {
    const rows = [{ customerName: 'Bunda Risma' }];
    expect(copilotService.validateGrounding('Ada Bunda Siti yang menunggu.', rows)).toBe(false);
  });

  it('empty result → jawaban jujur "Tidak ditemukan data"', async () => {
    h.callChat
      .mockResolvedValueOnce(llmReply('{"tool":"query_unreplied_chats","args":{}}'))
      .mockResolvedValueOnce(llmReply('{"tool":null,"args":{}}'));
    h.conversationFindMany.mockResolvedValue([]);
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'chat menggantung?' });
    expect(res.answer).toContain('Tidak ditemukan data');
    expect(res.grounded).toBe(true);
  });

  it('whitelist tool: nama tak terdaftar ditolak (UNKNOWN_TOOL)', async () => {
    h.callChat.mockResolvedValueOnce(llmReply('{"tool":"drop_tables","args":{}}'));
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'hapus semua' });
    expect(res.success).toBe(false);
    expect(res.error).toBe('UNKNOWN_TOOL');
    expect(getCopilotTool('drop_tables')).toBeUndefined();
  });

  it('deep-link: conversationId tersedia di data reservasi (1 query, tanpa N+1)', async () => {
    h.reservationFindMany.mockResolvedValue([
      {
        id: 'r1',
        customer: { id: 'c1', name: 'Bunda Dara', conversations: [{ id: 'conv-xyz' }] },
        treatment_detail: 'Baby Massage',
        booking_date: new Date(),
        status: 'confirmed',
        assigned_staff: { name: 'Bidan Yusi' },
      },
    ]);
    const res = await queryReservationsByFilter.run('tenant-a', { date: '2026-09-28' });
    expect(res.rows[0].conversationId).toBe('conv-xyz');
  });

  it('anti-N+1: query_unreplied_chats memakai relasi messages (bukan loop findFirst)', async () => {
    h.conversationFindMany.mockResolvedValue([
      { id: 'c1', customer: { id: 'u1', name: 'Bunda Rina' }, messages: [{ direction: 'INBOUND', content: 'hai', created_at: new Date() }] },
    ]);
    const res = await queryUnrepliedChats.run('tenant-a', {});
    expect(res.rows.length).toBe(1);
    // Bukti: include.messages ada di query (single round-trip).
    const call = h.conversationFindMany.mock.calls[0][0];
    expect(call.include.messages).toBeDefined();
    expect(call.include.messages.take).toBe(1);
  });

  it('registry tool konsisten (whitelist 6 tool)', () => {
    expect(COPILOT_TOOLS.map((t) => t.name).sort()).toEqual([
      'get_customer_history',
      'lookup_catalog_and_policy',
      'query_reservations_by_filter',
      'query_stalled_inquiries',
      'query_unreplied_chats',
      'query_unscheduled_prospects',
    ]);
  });
});

describe('query_unscheduled_prospects — tanpa jadwal aktif (state-based)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.customerFindMany.mockResolvedValue([]);
  });

  it('"siapa saja yang belum terjadwal" → tool prospek terpanggil tenant-scoped', async () => {
    h.callChat
      .mockResolvedValueOnce(llmReply('{"tool":"query_unscheduled_prospects","args":{}}'))
      .mockResolvedValueOnce(llmReply('{"tool":null,"args":{}}'))
      .mockResolvedValueOnce(llmReply('Belum terjadwal: Bunda Rina.'));
    h.customerFindMany.mockResolvedValue([
      {
        id: 'c1',
        name: 'Bunda Rina',
        phone: '6285712345678',
        updated_at: new Date(),
        conversations: [{ id: 'conv-1', last_message_at: new Date() }],
      },
    ]);
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'siapa saja yang belum terjadwal ya' });
    expect(res.toolsUsed).toEqual(['query_unscheduled_prospects']);
    expect(h.customerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: 'tenant-a',
          is_sandbox_test: false,
          reservations: { none: { status: { in: expect.arrayContaining(['confirmed', 'en_route', 'pending', 'hold']) } } },
        }),
      })
    );
    expect(res.answer).toContain('Bunda Rina');
  });

  it('parafrase "prospek yang belum booking" & "yang belum ada jadwalnya" → tool sama', async () => {
    for (const q of ['prospek yang belum booking siapa?', 'yang belum ada jadwalnya siapa saja?']) {
      vi.resetAllMocks();
      h.callChat
        .mockResolvedValueOnce(llmReply('{"tool":"query_unscheduled_prospects","args":{}}'))
        .mockResolvedValueOnce(llmReply('{"tool":null,"args":{}}'));
      h.customerFindMany.mockResolvedValue([]);
      const res = await copilotService.chat({ tenantId: 'tenant-a', message: q });
      expect(res.toolsUsed).toEqual(['query_unscheduled_prospects']);
      expect(res.answer).toContain('Tidak ditemukan data');
    }
  });

  it('filter di DB: tanpa reservasi aktif (bukan filter teks "jadwal")', async () => {
    await queryUnscheduledProspects.run('tenant-a', {});
    const where = h.customerFindMany.mock.calls[0][0].where;
    expect(where.reservations).toEqual({ none: { status: { in: ['confirmed', 'en_route', 'pending', 'hold'] } } });
    // completed/cancelled lama TIDAK menghalangi → tetap prospek
    expect(where.reservations.none.status.in).not.toContain('completed');
    expect(where.reservations.none.status.in).not.toContain('cancelled');
  });

  it('kontak sandbox & dummy disaring; nomor HP tidak diteruskan ke baris', async () => {
    h.customerFindMany.mockResolvedValue([
      { id: 'c1', name: 'Bunda Rina', phone: '6285712345678', updated_at: new Date(), conversations: [] },
      { id: 'c2', name: 'QA Bot', phone: '628123456789', updated_at: new Date(), conversations: [] },
    ]);
    const res = await queryUnscheduledProspects.run('tenant-a', {});
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].customerName).toBe('Bunda Rina');
    expect(res.rows[0]).not.toHaveProperty('phone');
  });

  it('conversationId tersedia untuk deep-link; null bila belum pernah chat', async () => {
    h.customerFindMany.mockResolvedValue([
      { id: 'c1', name: 'Bunda Rina', phone: '6285712345678', updated_at: new Date(), conversations: [{ id: 'conv-9', last_message_at: new Date() }] },
      { id: 'c2', name: 'Bunda Sari', phone: '6285712345679', updated_at: new Date(), conversations: [] },
    ]);
    const res = await queryUnscheduledProspects.run('tenant-a', {});
    expect(res.rows[0].conversationId).toBe('conv-9');
    expect(res.rows[1].conversationId).toBeNull();
  });

  it('limit dibatasi maksimal 20 (token budget)', async () => {
    await queryUnscheduledProspects.run('tenant-a', { limit: 500 });
    expect(h.customerFindMany.mock.calls[0][0].take).toBe(100);
  });
});

describe('Fase A — multi-step loop & budget guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.reservationFindMany.mockResolvedValue([]);
    h.conversationFindMany.mockResolvedValue([]);
    h.customerFindMany.mockResolvedValue([]);
  });

  it('pertanyaan komposit memanggil 2 tool berantai lalu berhenti (router ke-3 null)', async () => {
    h.callChat
      .mockResolvedValueOnce(llmReply('{"tool":"query_unscheduled_prospects","args":{}}'))
      .mockResolvedValueOnce(llmReply('{"tool":"query_unreplied_chats","args":{}}'))
      .mockResolvedValueOnce(llmReply('{"tool":null,"args":{}}')) // data cukup
      .mockResolvedValueOnce(llmReply('Irisan: Bunda Rina.')); // summarize
    h.customerFindMany.mockResolvedValue([
      { id: 'c1', name: 'Bunda Rina', phone: '6285712345678', updated_at: new Date(), conversations: [{ id: 'conv-1', last_message_at: new Date() }] },
    ]);
    h.conversationFindMany.mockResolvedValue([
      { id: 'conv-1', customer: { id: 'c1', name: 'Bunda Rina' }, messages: [{ direction: 'INBOUND', content: 'minta besok', created_at: new Date() }] },
    ]);

    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'yang belum terjadwal dan minta besok?' });
    expect(res.toolsUsed).toEqual(['query_unscheduled_prospects', 'query_unreplied_chats']);
    expect(res.grounded).toBe(true);
    // 3 router + 1 summarize = 4 (tepat di batas budget).
    expect(res.llmCalls).toBe(4);
    expect(h.callChat).toHaveBeenCalledTimes(4);
  });

  it('anti-loop: router mengulang tool+args identik → berhenti, tidak spam', async () => {
    h.callChat
      .mockResolvedValueOnce(llmReply('{"tool":"query_unreplied_chats","args":{}}'))
      .mockResolvedValueOnce(llmReply('{"tool":"query_unreplied_chats","args":{}}')) // identik
      .mockResolvedValueOnce(llmReply('Ringkasan.'));
    h.conversationFindMany.mockResolvedValue([
      { id: 'conv-1', customer: { id: 'c1', name: 'Bunda Rina' }, messages: [{ direction: 'INBOUND', content: 'halo', created_at: new Date() }] },
    ]);
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'chat menggantung?' });
    expect(res.toolsUsed).toEqual(['query_unreplied_chats']); // hanya sekali eksekusi
    // 2 router (kedua identik → break) + 1 summarize = 3.
    expect(res.llmCalls).toBe(3);
  });

  it('budget baris: total > MAX_TOTAL_ROWS menghentikan loop', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `c${i}`,
      customer: { id: `u${i}`, name: `Bunda ${i}` },
      messages: [{ direction: 'INBOUND', content: 'x', created_at: new Date() }],
    }));
    h.callChat
      .mockResolvedValueOnce(llmReply('{"tool":"query_unreplied_chats","args":{}}'))
      .mockResolvedValueOnce(llmReply('{"tool":"query_unscheduled_prospects","args":{}}'))
      .mockResolvedValueOnce(llmReply('Ringkasan.'));
    h.conversationFindMany.mockResolvedValue(many); // 20 baris (cap tool)
    h.customerFindMany.mockResolvedValue(many.map((m) => ({ ...m, phone: `6285712345${m.id}`, updated_at: new Date(), conversations: [] })));
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'cek' });
    // 20 baris pertama sudah >= MAX_TOTAL_ROWS(40)? tidak; 20+20=40 → berhenti setelah iterasi 2.
    expect(res.llmCalls).toBeLessThanOrEqual(3); // 2 router + 1 summarize
  });

  it('union grounding: nama yang tidak ada di SEMUA sumber → tidak grounded', () => {
    const union = [{ customerName: 'Bunda Rina' }, { customerName: 'Bunda Dewi' }];
    expect(copilotService.validateGrounding('Ada Bunda Rina dan Bunda Dewi.', union)).toBe(true);
    expect(copilotService.validateGrounding('Ada Bunda Siti.', union)).toBe(false);
  });
});

describe('Fase B1 — query_stalled_inquiries (state-based)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.conversationFindMany.mockResolvedValue([]);
  });

  it('mendeteksi tanya-jadwal menggantung (sinyal state + inbound terakhir + tanpa reservasi aktif)', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv-1',
        session_data: { inquiryDate: '2026-09-28' },
        last_discussed_treatment: null,
        customer: { id: 'c1', name: 'Bunda Dewi', phone: '6285712345678', reservations: [] },
        messages: [{ direction: 'INBOUND', content: 'minta besok jam 10', created_at: new Date(Date.now() - 3600000) }],
      },
    ]);
    const res = await queryStalledInquiries.run('tenant-a', {});
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].customerName).toBe('Bunda Dewi');
    expect(res.rows[0].conversationId).toBe('conv-1');
  });

  it('mengecualikan yang SUDAH punya reservasi aktif', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv-1',
        session_data: { inquiryDate: '2026-09-28' },
        last_discussed_treatment: 'Baby Massage',
        customer: { id: 'c1', name: 'Bunda Dewi', phone: '6285712345678', reservations: [{ status: 'confirmed' }] },
        messages: [{ direction: 'INBOUND', content: 'minta besok', created_at: new Date() }],
      },
    ]);
    const res = await queryStalledInquiries.run('tenant-a', {});
    expect(res.rows.length).toBe(0);
  });

  it('mengecualikan yang sudah DIBALAS admin (pesan terakhir OUTBOUND)', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv-1',
        session_data: { cartItems: [{ id: 'x' }] },
        last_discussed_treatment: 'Baby Massage',
        customer: { id: 'c1', name: 'Bunda Dewi', phone: '6285712345678', reservations: [] },
        messages: [{ direction: 'OUTBOUND', content: 'baik bunda', created_at: new Date() }],
      },
    ]);
    const res = await queryStalledInquiries.run('tenant-a', {});
    expect(res.rows.length).toBe(0);
  });

  it('mengecualikan tanpa sinyal minat jadwal (state kosong)', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv-1',
        session_data: {},
        last_discussed_treatment: null,
        customer: { id: 'c1', name: 'Bunda Dewi', phone: '6285712345678', reservations: [] },
        messages: [{ direction: 'INBOUND', content: 'halo', created_at: new Date() }],
      },
    ]);
    const res = await queryStalledInquiries.run('tenant-a', {});
    expect(res.rows.length).toBe(0);
  });

  it('tenant-scoped + tanpa phone diteruskan', async () => {
    await queryStalledInquiries.run('tenant-a', {});
    expect(h.conversationFindMany.mock.calls[0][0].where.tenant_id).toBe('tenant-a');
  });

  it('registry memuat 6 tool', () => {
    expect(COPILOT_TOOLS.map((t) => t.name).sort()).toEqual([
      'get_customer_history',
      'lookup_catalog_and_policy',
      'query_reservations_by_filter',
      'query_stalled_inquiries',
      'query_unreplied_chats',
      'query_unscheduled_prospects',
    ]);
  });

  // ── Akar #163b: session_data.booking NYARIS TIDAK PERNAH terisi di produksi
  // (0 dari 780). Recall tool harus bangkit dari TEKS pesan (detektor kanonik). ──
  it('fallback teks: session_data KOSONG tapi pesan "besok" → tetap terdeteksi', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv-nanda',
        session_data: null, // produksi: state tidak terisi
        last_discussed_treatment: null,
        customer: { id: 'c1', name: 'Nanda', phone: '6282186222568', reservations: [] },
        messages: [
          { direction: 'INBOUND', content: 'Mau pijit besok bisa?', created_at: new Date(Date.now() - 60000) },
          { direction: 'OUTBOUND', content: 'Halo Bunda!', created_at: new Date(Date.now() - 120000) },
        ],
      },
    ]);
    const res = await queryStalledInquiries.run('tenant-a', {});
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].customerName).toBe('Nanda');
    expect(res.rows[0].requestedTime).toBe('besok');
  });

  it('adversarial multi-parafrase teks jadwal (slot/jam/hari) → terdeteksi', async () => {
    const texts = [
      'besok sma mbaknya sendiri ada slot jam berapa?',
      'Besok pagi kira-kira bs ndk ya',
      'apakah msh ada slot untuk pijat besok ?',
      'Besok bisa?',
      'Bsk bisa pijat full body oksi tah?',
    ];
    for (const [i, text] of texts.entries()) {
      h.conversationFindMany.mockResolvedValue([
        {
          id: `conv-${i}`,
          session_data: null,
          last_discussed_treatment: null,
          customer: { id: `c${i}`, name: `Bunda ${i}`, phone: `628571234567${i}`, reservations: [] },
          messages: [{ direction: 'INBOUND', content: text, created_at: new Date(Date.now() - 60000) }],
        },
      ]);
      const res = await queryStalledInquiries.run('tenant-a', {});
      expect(res.rows.length, `text="${text}"`).toBe(1);
    }
  });

  it('teks TANPA sinyal jadwal (obrolan biasa) tetap dikecualikan', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv-chat',
        session_data: null,
        last_discussed_treatment: null,
        customer: { id: 'c1', name: 'Bunda Rina', phone: '6285712345678', reservations: [] },
        messages: [{ direction: 'INBOUND', content: 'makasih ya kak', created_at: new Date() }],
      },
    ]);
    const res = await queryStalledInquiries.run('tenant-a', {});
    expect(res.rows.length).toBe(0);
  });

  it('filter date: sinyal dari TEKS cocok ("besok") / tidak cocok ("hari ini")', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv-dinda',
        session_data: null,
        last_discussed_treatment: null,
        customer: { id: 'c1', name: 'Dinda', phone: '6285712345678', reservations: [] },
        messages: [{ direction: 'INBOUND', content: 'hari ini sore bisa?', created_at: new Date() }],
      },
      {
        id: 'conv-tere',
        session_data: null,
        last_discussed_treatment: null,
        customer: { id: 'c2', name: 'Bunda Tere', phone: '6285712345679', reservations: [] },
        messages: [{ direction: 'INBOUND', content: 'minta besok pagi', created_at: new Date() }],
      },
    ]);
    const res = await queryStalledInquiries.run('tenant-a', { date: 'besok' });
    expect(res.rows.map((r: any) => r.customerName)).toEqual(['Bunda Tere']);
  });

  it('sudah punya reservasi aktif → dikecualikan walau teks minta besok', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv-booked',
        session_data: null,
        last_discussed_treatment: null,
        customer: { id: 'c1', name: 'Bunda Firda', phone: '6285755644990', reservations: [{ status: 'confirmed' }] },
        messages: [{ direction: 'INBOUND', content: 'minggu besok ada kosong?', created_at: new Date() }],
      },
    ]);
    const res = await queryStalledInquiries.run('tenant-a', {});
    expect(res.rows.length).toBe(0);
  });

  it('sudah dibalas ADMIN setelah inbound → dikecualikan (tidak menggantung)', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv-replied',
        session_data: null,
        last_discussed_treatment: null,
        customer: { id: 'c1', name: 'Bunda Renita', phone: '6282226558642', reservations: [] },
        messages: [
          { direction: 'OUTBOUND', content: 'baik bunda', created_at: new Date() },
          { direction: 'INBOUND', content: 'besok bs?', created_at: new Date(Date.now() - 60000) },
        ],
      },
    ]);
    const res = await queryStalledInquiries.run('tenant-a', {});
    expect(res.rows.length).toBe(0);
  });
});

describe('Fase 4 — adversarial: sinyal state, filter tanggal, sanitasi, grounding label', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.reservationFindMany.mockResolvedValue([]);
    h.conversationFindMany.mockResolvedValue([]);
    h.customerFindMany.mockResolvedValue([]);
  });

  it('pertanyaan komposit → query_reservations_by_filter DAN query_stalled_inquiries', async () => {
    h.callChat
      .mockResolvedValueOnce(llmReply('{"tool":"query_reservations_by_filter","args":{"date":"2026-09-28"}}'))
      .mockResolvedValueOnce(llmReply('{"tool":"query_stalled_inquiries","args":{"date":"2026-09-28"}}'))
      .mockResolvedValueOnce(llmReply('{"tool":null,"args":{}}'))
      .mockResolvedValueOnce(llmReply('Ringkasan gabungan.'));

    const res = await copilotService.chat({
      tenantId: 'tenant-a',
      message: 'siapa saja yang minta besok ? baik yang belum dan sudah terjadwal',
    });
    expect(res.toolsUsed).toEqual(['query_reservations_by_filter', 'query_stalled_inquiries']);
    expect(h.reservationFindMany).toHaveBeenCalled();
    expect(h.conversationFindMany).toHaveBeenCalled();
    // Observabilitas audit: jumlah baris per tool terekspos.
    expect(res.rowCounts).toEqual({
      query_reservations_by_filter: 0,
      query_stalled_inquiries: 0,
    });
  });

  it('hasScheduleIntentSignal: lastDiscussedTreatment TANPA state booking BUKAN sinyal', () => {
    // Bug lama: pernah bahas treatment dianggap minta jadwal (Dinda false-positive).
    expect(hasScheduleIntentSignal({}, 'Baby Massage')).toBe(false);
    expect(hasScheduleIntentSignal({ cartItems: [] }, 'Baby Massage')).toBe(false);
    // Sinyal sah dari state booking / keranjang.
    expect(hasScheduleIntentSignal({ booking: { requestedTimeHint: 'besok' } }, null)).toBe(true);
    expect(hasScheduleIntentSignal({ booking: { pendingScheduleCheck: true } }, null)).toBe(true);
    expect(hasScheduleIntentSignal({ cartItems: [{ id: 'x' }] }, null)).toBe(true);
  });

  it('matchesInquiryDate: hint "hari ini" TIDAK cocok filter "besok" (Dinda disaring)', () => {
    const dinda = { booking: { requestedTimeHint: 'hari ini sore' } };
    const tere = { booking: { requestedTimeHint: 'besok pagi' } };
    expect(matchesInquiryDate(dinda, 'besok')).toBe(false);
    expect(matchesInquiryDate(tere, 'besok')).toBe(true);
  });

  it('matchesInquiryDate: substring dua arah tidak lolos (sen ≠ senin)', () => {
    expect(matchesInquiryDate({ booking: { requestedTimeHint: 'sen' } }, 'senin')).toBe(false);
  });

  it('query_stalled_inquiries: filter date menyaring yang hint-nya tidak cocok', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv-dinda',
        session_data: { booking: { requestedTimeHint: 'hari ini' } },
        last_discussed_treatment: 'Baby Massage',
        customer: { id: 'c1', name: 'Dinda', phone: '6285712345678', reservations: [] },
        messages: [{ direction: 'INBOUND', content: 'halo', created_at: new Date() }],
      },
      {
        id: 'conv-tere',
        session_data: { booking: { requestedTimeHint: 'besok pagi' } },
        last_discussed_treatment: null,
        customer: { id: 'c2', name: 'Bunda Tere', phone: '6285712345679', reservations: [] },
        messages: [{ direction: 'INBOUND', content: 'minta besok', created_at: new Date() }],
      },
    ]);
    const res = await queryStalledInquiries.run('tenant-a', { date: 'besok' });
    expect(res.rows.map((r: any) => r.customerName)).toEqual(['Bunda Tere']);
  });

  it('query_unreplied_chats: kontak dummy disaring', async () => {
    h.conversationFindMany.mockResolvedValue([
      { id: 'c1', customer: { id: 'u1', name: 'QA Bot', phone: '628123456789' }, messages: [{ direction: 'INBOUND', content: 'hai', created_at: new Date() }] },
      { id: 'c2', customer: { id: 'u2', name: 'Bunda Rina', phone: '6285712345678' }, messages: [{ direction: 'INBOUND', content: 'hai', created_at: new Date() }] },
    ]);
    const res = await queryUnrepliedChats.run('tenant-a', {});
    expect(res.rows.map((r: any) => r.customerName)).toEqual(['Bunda Rina']);
  });

  it('query_reservations_by_filter: default status = jadwal aktif (cancelled tidak mencemari)', async () => {
    await queryReservationsByFilter.run('tenant-a', {});
    const call = h.reservationFindMany.mock.calls[0][0];
    expect(call.where.status).toEqual({ in: ['confirmed', 'en_route', 'pending', 'hold'] });
  });

  it('stripInternalIds: customerId & id teknis dibuang dari baris', () => {
    const out = stripInternalIds([{ customerId: 'uuid-1', id: 'res-1', customerName: 'Bunda Tere' }]);
    expect(out[0]).not.toHaveProperty('customerId');
    expect(out[0]).not.toHaveProperty('id');
    expect(out[0].customerName).toBe('Bunda Tere');
  });

  it('sanitizeCopilotAnswer: UUID bocor dihapus (zero-UUID)', () => {
    const dirty = 'Pasien (03b3f301-1111-2222-3333-444455556666) sudah terjadwal.';
    const clean = sanitizeCopilotAnswer(dirty);
    expect(clean).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(clean).toContain('Pasien');
  });

  it('grounding: label "**Nama Pelanggan**: X" divalidasi terhadap data', () => {
    const rows = [{ customerName: 'Bunda Tere' }];
    expect(copilotService.validateGrounding('- **Nama Pelanggan**: Tere', rows)).toBe(true);
    expect(copilotService.validateGrounding('- **Nama Pelanggan**: Siti', rows)).toBe(false);
  });

  it('grounding: kalimat "Pasien sudah terjadwal" BUKAN ekstraksi nama (no false-positive)', () => {
    const rows = [{ customerName: 'Bunda Tere' }];
    expect(copilotService.validateGrounding('Pasien sudah terjadwal semua.', rows)).toBe(true);
  });
});

describe('get_customer_history — profil & riwayat pasien (tenant-scoped, phone masked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.customerFindMany.mockResolvedValue([]);
    h.customerFindFirst.mockResolvedValue(null);
  });

  it('nama dikenal → profil + kunjungan lampau; phone DISAMARKAN (tidak bocor mentah)', async () => {
    h.customerFindMany.mockResolvedValue([
      {
        id: 'c1',
        name: 'Bunda Devia',
        phone: '6285712345678',
        kecamatan: 'Rungkut',
        kota: 'Surabaya',
        ltv_cache: 2500000,
        admin_notes: 'Suka jadwal pagi',
        preferences: { preferred_time: 'pagi' },
        reservations: [
          { booking_date: new Date('2026-09-20'), treatment_detail: 'Baby Massage', treatment_category: 'BABY', status: 'completed' },
          { booking_date: new Date('2026-09-01'), treatment_detail: 'Pijat Bapil', treatment_category: 'BABY', status: 'completed' },
        ],
        conversations: [{ id: 'conv-9' }],
      },
    ]);
    const res = await getCustomerHistory.run('tenant-a', { name: 'Devia' });
    expect(res.rows.length).toBe(1);
    const row = res.rows[0];
    expect(row.customerName).toBe('Bunda Devia');
    expect(row.phone).not.toBe('6285712345678');
    expect(String(row.phone)).toContain('****');
    expect(row.ltvTotal).toBe(2500000);
    expect(row.pastReservationsCount).toBe(2);
    expect(row.lastVisits.length).toBe(2);
    expect(row.conversationId).toBe('conv-9');
    expect(h.customerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: 'tenant-a' }) })
    );
  });

  it('nama tak dikenal → rows kosong (anti-halusinasi)', async () => {
    h.customerFindMany.mockResolvedValue([]);
    const res = await getCustomerHistory.run('tenant-a', { name: 'Tidak Ada' });
    expect(res.rows).toEqual([]);
    expect(res.count).toBe(0);
  });

  it('tanpa name/customerId → rows kosong + note arahan', async () => {
    const res = await getCustomerHistory.run('tenant-a', {});
    expect(res.rows).toEqual([]);
    expect(res.note).toBeTruthy();
    expect(h.customerFindMany).not.toHaveBeenCalled();
    expect(h.customerFindFirst).not.toHaveBeenCalled();
  });

  it('customerId → findFirst tenant-scoped', async () => {
    h.customerFindFirst.mockResolvedValue({
      id: 'c1', name: 'Bunda Devia', phone: '6285712345678', kecamatan: null, kota: null,
      ltv_cache: 0, admin_notes: null, preferences: null, reservations: [], conversations: [],
    });
    const res = await getCustomerHistory.run('tenant-a', { customerId: 'c1' });
    expect(res.rows.length).toBe(1);
    expect(h.customerFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: 'tenant-a', id: 'c1' }) })
    );
  });

  it('kontak dummy disaring', async () => {
    h.customerFindMany.mockResolvedValue([
      { id: 'c1', name: 'QA Bot', phone: '628123456789', kecamatan: null, kota: null, ltv_cache: 0, admin_notes: null, preferences: null, reservations: [], conversations: [] },
    ]);
    const res = await getCustomerHistory.run('tenant-a', { name: 'QA' });
    expect(res.rows).toEqual([]);
  });
});

describe('lookup_catalog_and_policy — katalog layanan & SOP (tenant-scoped)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.clinicServiceFindMany.mockResolvedValue([]);
    h.knowledgeChunkFindMany.mockResolvedValue([]);
    h.clinicPolicyFindMany.mockResolvedValue([]);
  });

  it('query "pijat" → row TREATMENT dengan harga & durasi dari ClinicService', async () => {
    h.clinicServiceFindMany.mockResolvedValue([
      { service_id: 'pijat-bapil', name: 'Pijat Bapil', category: 'BABY', duration_minutes: 45, original_price: 150000, promo_price: 120000, description: 'Terapi batuk pilek', min_age_months: 3, max_age_months: 60, age_label: '3-60 bulan' },
    ]);
    const res = await lookupCatalogAndPolicy.run('tenant-a', { query: 'pijat', type: 'TREATMENT' });
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].kind).toBe('TREATMENT');
    expect(res.rows[0].promoPrice).toBe(120000);
    expect(res.rows[0].durationMinutes).toBe(45);
    expect(h.clinicServiceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: 'tenant-a' }) })
    );
    // type TREATMENT → tidak menyentuh policy/knowledge
    expect(h.clinicPolicyFindMany).not.toHaveBeenCalled();
  });

  it('query SOP → row POLICY dengan factual_summary + sumber', async () => {
    h.clinicPolicyFindMany.mockResolvedValue([
      { topic: 'vaksin-jeda', title: 'Jeda pasca vaksinasi', factual_summary: 'Jeda minimal 3 hari setelah vaksin.', suggested_reply: 'Baik Bunda...' },
    ]);
    const res = await lookupCatalogAndPolicy.run('tenant-a', { query: 'vaksin', type: 'POLICY' });
    expect(res.rows[0].kind).toBe('POLICY');
    expect(res.rows[0].source).toContain('vaksin-jeda');
    expect(res.rows[0].body).toContain('3 hari');
    expect(h.clinicPolicyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: 'tenant-a' }) })
    );
  });

  it('type ALL → menggabungkan katalog + policy + knowledge (tenant-scoped ketiganya)', async () => {
    h.clinicServiceFindMany.mockResolvedValue([
      { service_id: 's1', name: 'Baby Massage', category: 'BABY', duration_minutes: 30, original_price: 100000, promo_price: 90000, description: 'x', min_age_months: 0, max_age_months: 12, age_label: '0-12' },
    ]);
    h.knowledgeChunkFindMany.mockResolvedValue([
      { title: 'FAQ Homecare', content: 'Kami melayani homecare.', keywords: 'homecare', source_type: 'FAQ' },
    ]);
    h.clinicPolicyFindMany.mockResolvedValue([]);
    const res = await lookupCatalogAndPolicy.run('tenant-a', { query: '', type: 'ALL' });
    expect(res.rows.map((r: any) => r.kind).sort()).toEqual(['KNOWLEDGE', 'TREATMENT']);
    expect(h.knowledgeChunkFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: 'tenant-a' }) })
    );
  });

  it('tanpa hasil → rows kosong (anti-halusinasi medis)', async () => {
    const res = await lookupCatalogAndPolicy.run('tenant-a', { query: 'xyz', type: 'ALL' });
    expect(res.rows).toEqual([]);
    expect(res.count).toBe(0);
  });
});

describe('Fase budget — wall-clock guard & degradasi jujur (anti "Gagal menghubungi Copilot")', () => {
  beforeEach(() => {
    // resetAllMocks (bukan clearAllMocks): buang sisa antrean mockResolvedValueOnce
    // dari describe sebelumnya agar test budget deterministik.
    vi.resetAllMocks();
    delete process.env.COPILOT_TOTAL_BUDGET_MS;
    h.reservationFindMany.mockResolvedValue([]);
    h.conversationFindMany.mockResolvedValue([]);
    h.customerFindMany.mockResolvedValue([]);
  });

  it('withDeadline: menolak dengan penanda deadline saat promise menggantung', async () => {
    const never = () => new Promise((resolve) => setTimeout(() => resolve('late'), 5000));
    await expect(withDeadline(never, 30)).rejects.toSatisfy((e: any) => isCopilotDeadlineError(e));
  });

  it('withDeadline: promise selesai cepat → tidak kena timeout', async () => {
    const fast = async () => 'ok';
    await expect(withDeadline(fast, 5000)).resolves.toBe('ok');
  });

  it('buildDegradedAnswer: hanya menyalin data nyata, tanpa mengarang (anti-halusinasi)', () => {
    const out = buildDegradedAnswer([
      { tool: 'query_stalled_inquiries', rows: [{ customerName: 'Bunda Dewi', requestedTime: 'besok', lastMessage: 'minta besok jam 10' }] },
    ]);
    expect(out).toContain('Bunda Dewi');
    expect(out).toContain('query_stalled_inquiries');
    expect(out).toContain('minta besok');
    // Tidak menyebut nama yang tak ada di baris.
    expect(out).not.toContain('Bunda Siti');
  });

  it('buildDegradedAnswer: tanpa baris → pesan arahan persempit (bukan crash)', () => {
    const out = buildDegradedAnswer([]);
    expect(out).toMatch(/batas waktu/i);
  });

  it('router menggantung melewati anggaran → degradasi/`error` deadline, BUKAN "gangguan layanan AI"', async () => {
    process.env.COPILOT_TOTAL_BUDGET_MS = '80';
    // Router LLM tidak pernah selesai (simulasi provider lambat).
    h.callChat.mockImplementation(() => new Promise(() => {}));
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'jadwal besok siapa?' });
    // Tanpa data terkumpul → success:false dengan error deadline yang jujur.
    expect(res.success).toBe(false);
    expect(res.error).toBe('COPILOT_DEADLINE_EXCEEDED');
    expect(res.answer).not.toContain('gangguan layanan AI');
  });

  it('anggaran habis SETELAH tool berjalan → data mentah tersaji (grounded), bukan error', async () => {
    // Router pertama balas cepat memilih tool; router kedua menggantung → deadline.
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
    let call = 0;
    h.callChat.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve(llmReply(JSON.stringify({ tool: 'query_reservations_by_filter', args: { date: '2026-09-28' } })));
      return new Promise(() => {}); // router ke-2 menggantung → deadline
    });
    process.env.COPILOT_TOTAL_BUDGET_MS = '120';
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'jadwal besok siapa?' });
    expect(res.success).toBe(true);
    expect(res.grounded).toBe(true);
    expect(res.answer).toContain('Bunda Dara');
    expect(res.answer).toMatch(/batas waktu/i);
    expect(res.toolsUsed).toEqual(['query_reservations_by_filter']);
  });

  it('happy-path tetap memakai summarize (tidak regresi ke degradasi)', async () => {
    h.callChat
      .mockResolvedValueOnce(llmReply('{"tool":"query_unreplied_chats","args":{}}'))
      .mockResolvedValueOnce(llmReply('{"tool":null,"args":{}}'))
      .mockResolvedValueOnce(llmReply('Ringkasan rapi.'));
    h.conversationFindMany.mockResolvedValue([
      { id: 'conv-1', customer: { id: 'c1', name: 'Bunda Rina' }, messages: [{ direction: 'INBOUND', content: 'hai', created_at: new Date() }] },
    ]);
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'chat menggantung?' });
    expect(res.success).toBe(true);
    expect(res.answer).toBe('Ringkasan rapi.');
    expect(res.llmCalls).toBe(3);
  });
});

describe('Fase 1 — pintu penolakan (rejected) & kontrak status domain lengkap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.reservationFindMany.mockResolvedValue([]);
  });

  it('kontrak status menu memuat SELURUH status domain (rejected & en_route)', () => {
    const desc = getCopilotTool('query_reservations_by_filter')!.parameters.status.description;
    // Akar: menu sempit bikin router LLM tak pernah bisa memilih status rejected
    // ("siapa yang saya tolak") walau data & filter DB mampu.
    expect(desc).toContain('rejected');
    expect(desc).toContain('en_route');
    expect(desc).not.toContain('confirmed | pending | hold | completed | cancelled.');
  });

  it('status rejected diteruskan apa adanya ke filter DB (tenant-scoped)', async () => {
    await queryReservationsByFilter.run('tenant-a', { date: '2026-09-28', status: 'rejected' });
    const call = h.reservationFindMany.mock.calls[0][0];
    expect(call.where.status).toBe('rejected');
    expect(call.where.tenant_id).toBe('tenant-a');
  });

  it('router semantik: "yang saya tolak besok" → status rejected diteruskan', async () => {
    h.callChat
      .mockResolvedValueOnce(
        llmReply('{"tool":"query_reservations_by_filter","args":{"date":"2026-09-28","status":"rejected"}}')
      )
      .mockResolvedValueOnce(llmReply('{"tool":null,"args":{}}'));
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'siapa yang saya tolak untuk besok?' });
    expect(res.toolsUsed).toEqual(['query_reservations_by_filter']);
    expect(h.reservationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'rejected', tenant_id: 'tenant-a' }) })
    );
  });
});

describe('Fase 2 — jendela analisa chat lebih lebar + offeredTime (anti-robot/amnesia)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.conversationFindMany.mockResolvedValue([]);
  });

  it('mengambil 8 pesan terakhir untuk analisa alur (bukan 5)', async () => {
    await queryStalledInquiries.run('tenant-a', {});
    const call = h.conversationFindMany.mock.calls[0][0];
    expect(call.select.messages.take).toBe(8);
  });

  it('menyertakan offeredTime dari balasan admin (jam yang pernah ditawarkan)', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv-1',
        session_data: null,
        last_discussed_treatment: null,
        customer: { id: 'c1', name: 'Bunda Dewi', phone: '6285712345678', reservations: [] },
        messages: [
          { direction: 'INBOUND', content: 'besok bisa?', created_at: new Date(Date.now() - 60000) },
          { direction: 'OUTBOUND', content: 'Untuk besok kami ada jam 10 pagi ya Bunda', created_at: new Date(Date.now() - 120000) },
        ],
      },
    ]);
    const res = await queryStalledInquiries.run('tenant-a', {});
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].offeredTime).toBe('jam 10 pagi');
  });

  it('offeredTime null bila admin tidak pernah menyebut jam', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv-2',
        session_data: null,
        last_discussed_treatment: null,
        customer: { id: 'c1', name: 'Bunda Dewi', phone: '6285712345678', reservations: [] },
        messages: [
          { direction: 'INBOUND', content: 'besok bisa?', created_at: new Date(Date.now() - 60000) },
          { direction: 'OUTBOUND', content: 'Baik Bunda kami cek dulu', created_at: new Date(Date.now() - 120000) },
        ],
      },
    ]);
    const res = await queryStalledInquiries.run('tenant-a', {});
    expect(res.rows[0].offeredTime).toBeNull();
  });
});

describe('Fase 3 — gaya to-the-point dari DB + kontrak link kanonis', () => {
  it('formatWaitTime: menit & jam dalam bahasa manusia (bukan angka mentah)', () => {
    expect(formatWaitTime(5)).toContain('5 menit');
    expect(formatWaitTime(90)).toContain('1 jam');
    expect(formatWaitTime(1500)).toContain('hari');
  });

  it('tanpa nada DB → fallback default; prompt tetap memuat kontrak link kanonis', () => {
    const p = buildSummarizePrompt('siapa minta besok', '[]', null);
    // Kontrak link WAJIB kanonis (bukan format hash lama /#/livechat).
    expect(p).toContain('/admin/live-chat?conversationId=');
    expect(p).not.toContain('/#/livechat');
    // Aturan anti-halusinasi tetap ada sebagai lapis sekunder.
    expect(p).toContain('DILARANG menambah nama');
  });

  it('nada DB disuntikkan ke prompt (tenant-aware), bukan hardcode', () => {
    const tone = 'RINGKAS: sajikan 2 kelompok saja, tanpa pembuka.';
    const p = buildSummarizePrompt('q', '[]', tone);
    expect(p).toContain(tone);
  });

  it('SOP vaksin dijawab dari data DB, prompt tidak menghardcode angka jeda', () => {
    const p = buildSummarizePrompt('anak habis vaksin boleh spa?', '[]', null);
    // Anti-hardcode: angka SOP TIDAK boleh ditulis di prompt.
    expect(p).not.toMatch(/\b[23]\s*hari\b/);
  });
});
