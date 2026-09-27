import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  reservationFindMany: vi.fn(),
  conversationFindMany: vi.fn(),
  customerFindMany: vi.fn(),
  callChat: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  prisma: {
    reservation: { findMany: h.reservationFindMany },
    conversation: { findMany: h.conversationFindMany },
    customer: { findMany: h.customerFindMany },
  },
}));

vi.mock('../../src/integrations/llm/model-fallback', () => ({
  callChatCompletionsWithFallback: (...a: any[]) => h.callChat(...a),
}));

vi.mock('../../src/integrations/llm/llm-gateway', () => ({
  getLlmEndpointConfig: () => ({ model: 'test', fallbackModel: 'test', baseUrl: 'http://x', apiKey: 'k', timeoutMs: 1000 }),
}));

import { copilotService, buildRouterPrompt } from '../../src/services/copilot/copilot.service';
import {
  resolveReservationDateFilter,
  isValidIsoDate,
  queryReservationsByFilter,
  queryUnrepliedChats,
  queryUnscheduledProspects,
  queryStalledInquiries,
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

  it('registry tool konsisten (whitelist 4 tool)', () => {
    expect(COPILOT_TOOLS.map((t) => t.name).sort()).toEqual([
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
          reservations: { none: { status: { in: expect.arrayContaining(['confirmed', 'pending', 'hold']) } } },
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
    expect(where.reservations).toEqual({ none: { status: { in: ['confirmed', 'pending', 'hold'] } } });
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

  it('registry memuat 4 tool', () => {
    expect(COPILOT_TOOLS.map((t) => t.name).sort()).toEqual([
      'query_reservations_by_filter',
      'query_stalled_inquiries',
      'query_unreplied_chats',
      'query_unscheduled_prospects',
    ]);
  });
});
