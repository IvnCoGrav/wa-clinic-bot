import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  reservationFindMany: vi.fn(),
  conversationFindMany: vi.fn(),
  callChat: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  prisma: {
    reservation: { findMany: h.reservationFindMany },
    conversation: { findMany: h.conversationFindMany },
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
    vi.clearAllMocks();
    h.reservationFindMany.mockResolvedValue([]);
    h.conversationFindMany.mockResolvedValue([]);
  });

  // 5 parafrase: yang diuji = plumbing deterministik (mock LLM → args diteruskan ke tool benar).
  const paraphrases: Array<{ q: string; tool: string; args: any }> = [
    { q: 'Jadwal besok siapa saja ya', tool: 'query_reservations_by_filter', args: { date: '2026-09-28' } },
    { q: 'Kalau minta besok siapa saja', tool: 'query_reservations_by_filter', args: { date: '2026-09-28' } },
    { q: 'Ada yang minta hari minggu minggu depan? coba cek', tool: 'query_reservations_by_filter', args: { date: '2026-10-04' } },
    { q: 'Chat yang belum dibalas siapa aja', tool: 'query_unreplied_chats', args: {} },
    { q: 'jadwal hari ini', tool: 'query_reservations_by_filter', args: { date: '2026-09-27' } },
  ];

  for (const { q, tool, args } of paraphrases) {
    it(`"${q}" → tool ${tool} dengan args diteruskan apa adanya`, async () => {
      h.callChat.mockResolvedValueOnce(llmReply(JSON.stringify({ tool, args })));
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
    h.callChat.mockResolvedValueOnce(llmReply('{"tool":"query_unreplied_chats","args":{}}'));
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

  it('registry tool konsisten (whitelist hanya 2 tool)', () => {
    expect(COPILOT_TOOLS.map((t) => t.name).sort()).toEqual(['query_reservations_by_filter', 'query_unreplied_chats']);
  });
});
