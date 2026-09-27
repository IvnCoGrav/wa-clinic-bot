import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  reservationFindMany: vi.fn(),
  conversationFindMany: vi.fn(),
  messageFindFirst: vi.fn(),
  callChat: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  prisma: {
    reservation: { findMany: h.reservationFindMany },
    conversation: { findMany: h.conversationFindMany },
    message: { findFirst: h.messageFindFirst },
  },
}));

vi.mock('../../src/integrations/llm/model-fallback', () => ({
  callChatCompletionsWithFallback: (...a: any[]) => h.callChat(...a),
}));

vi.mock('../../src/integrations/llm/llm-gateway', () => ({
  getLlmEndpointConfig: () => ({ model: 'test', fallbackModel: 'test', baseUrl: 'http://x', apiKey: 'k', timeoutMs: 1000 }),
}));

import { copilotService } from '../../src/services/copilot/copilot.service';
import { queryReservationsByFilter, queryUnrepliedChats, getCopilotTool } from '../../src/services/copilot/copilot-tools';

function llmReply(content: string) {
  return { data: { choices: [{ message: { content } }] } };
}

describe('Copilot grounding (Fase 6r)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.reservationFindMany.mockResolvedValue([]);
    h.conversationFindMany.mockResolvedValue([]);
    h.messageFindFirst.mockResolvedValue(null);
  });

  it('tool kosong → jawaban jujur "tidak ditemukan", BUKAN halusinasi', async () => {
    h.callChat.mockResolvedValueOnce(llmReply('{"tool":"query_reservations_by_filter","args":{"date":"2026-09-28"}}'));
    h.reservationFindMany.mockResolvedValue([]);
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'jadwal besok?' });
    expect(res.success).toBe(true);
    expect(res.answer).toContain('Tidak ditemukan');
    expect(res.grounded).toBe(true);
    // Hanya 1 panggilan LLM (router); tidak ada call summarize karena kosong.
    expect(h.callChat).toHaveBeenCalledTimes(1);
  });

  it('tidak ada tool cocok → jawaban sopan tanpa memanggil tool', async () => {
    h.callChat.mockResolvedValueOnce(llmReply('{"tool":null,"args":{}}'));
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'apa kabar?' });
    expect(res.toolsUsed).toEqual([]);
    expect(h.reservationFindMany).not.toHaveBeenCalled();
  });

  it('tool dipanggil tenant-scoped (anti IDOR)', async () => {
    h.callChat.mockResolvedValueOnce(llmReply('{"tool":"query_reservations_by_filter","args":{"date":"2026-09-28"}}'));
    h.reservationFindMany.mockResolvedValue([
      { id: 'r1', customer: { id: 'c1', name: 'Bunda Alin' }, treatment_detail: 'Baby Massage', booking_date: new Date(), status: 'confirmed', assigned_staff: { name: 'Bidan Yusi' } },
    ]);
    h.callChat.mockResolvedValueOnce(llmReply('Ada 1 jadwal: Bunda Alin.'));
    await copilotService.chat({ tenantId: 'tenant-a', message: 'jadwal besok?' });
    expect(h.reservationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: 'tenant-a' }) })
    );
  });

  it('validator grounding: nama di jawaban ada di hasil tool → grounded', () => {
    const rows = [{ customerName: 'Bunda Alin' }, { customerName: 'Bunda Dewi' }];
    expect(copilotService.validateGrounding('Ada Bunda Alin dan Bunda Dewi.', rows)).toBe(true);
  });

  it('validator grounding: nama TIDAK ada di hasil tool → halusinasi (false)', () => {
    const rows = [{ customerName: 'Bunda Alin' }];
    expect(copilotService.validateGrounding('Ada Bunda Siti yang menunggu.', rows)).toBe(false);
  });

  it('tool query_unreplied_chats: hanya INBOUND terakhir (state-based)', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'conv1',
        customer: { id: 'c1', name: 'Bunda Rina' },
        // Anti-N+1: relasi messages (take 1) dikembalikan langsung oleh findMany.
        messages: [{ direction: 'INBOUND', content: 'halo', created_at: new Date(Date.now() - 600000) }],
      },
    ]);
    const res = await queryUnrepliedChats.run('tenant-a', {});
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].customerName).toBe('Bunda Rina');
    // Bukti anti-N+1: tidak ada pemanggilan message.findFirst per-percakapan.
    expect(h.messageFindFirst).not.toHaveBeenCalled();
  });

  it('getCopilotTool hanya mengembalikan tool terdaftar (whitelist)', () => {
    expect(getCopilotTool('query_reservations_by_filter')).toBeTruthy();
    expect(getCopilotTool('drop_all_tables')).toBeUndefined();
  });

  it('LLM error → success false + pesan ramah (tidak throw)', async () => {
    h.callChat.mockRejectedValue(new Error('LLM down'));
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'jadwal?' });
    expect(res.success).toBe(false);
    expect(res.answer).toContain('tidak tersedia');
  });
});
