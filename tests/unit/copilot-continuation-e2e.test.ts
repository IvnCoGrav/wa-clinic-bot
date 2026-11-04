import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  reservationFindMany: vi.fn(),
  callChat: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  prisma: {
    reservation: { findMany: h.reservationFindMany },
  },
}));

vi.mock('../../src/integrations/llm/model-fallback', () => ({
  callChatCompletionsWithFallback: (...a: any[]) => h.callChat(...a),
}));

vi.mock('../../src/integrations/llm/llm-gateway', () => ({
  getLlmEndpointConfig: () => ({
    model: 'test',
    fallbackModel: 'test',
    baseUrl: 'http://test',
    apiKey: 'key',
    timeoutMs: 5000,
  }),
}));

import { copilotService } from '../../src/services/copilot/copilot.service';

describe('Copilot auto-continuation E2E (Fase 11 - Menutup V4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('melakukan panggilan LLM lanjutan secara otomatis saat finish_reason === "length"', async () => {
    // 1. Router call: memilih query_reservations_by_filter
    h.callChat.mockResolvedValueOnce({
      data: { choices: [{ message: { content: '{"tool":"query_reservations_by_filter","args":{"date":"2026-11-04"}}' } }] },
    });

    // 2. Router step 2: terminasi tool loop
    h.callChat.mockResolvedValueOnce({
      data: { choices: [{ message: { content: '{"tool":null,"args":{}}' } }] },
    });

    // 3. Summarize call 1: terpotong di tengah jalan (finish_reason: 'length')
    h.callChat.mockResolvedValueOnce({
      data: {
        choices: [
          {
            finish_reason: 'length',
            message: {
              content: 'Berikut adalah jadwal klinik hari ini: 1. Pasien Bunda Sarah jam 09:00 WIB, 2. Pasien Bunda Dewi jam',
            },
          },
        ],
      },
    });

    // 4. Continuation call: melanjutkan kalimat tanpa mengulang
    h.callChat.mockResolvedValueOnce({
      data: {
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: '10:00 WIB bersama Bidan Thabita. Semua jadwal sudah terkonfirmasi dengan rapi.',
            },
          },
        ],
      },
    });

    h.reservationFindMany.mockResolvedValue([
      {
        id: 'r1',
        booking_date: new Date('2026-11-04T02:00:00Z'),
        status: 'confirmed',
        treatment_detail: 'Baby Spa',
        customer: { id: 'c1', name: 'Bunda Sarah', phone: '6281234567801' },
      },
    ]);

    const res = await copilotService.chat({ tenantId: 'tenant-test', message: 'jadwal hari ini' });

    expect(res.success).toBe(true);
    // Verifikasi 4 panggilan LLM terjadi: 2 router + 1 summarize terpotong + 1 lanjutan otomatis
    expect(h.callChat).toHaveBeenCalledTimes(4);
    expect(res.llmCalls).toBe(4);

    // Teks tersambung mulus
    expect(res.answer).toContain('Pasien Bunda Sarah jam 09:00 WIB');
    expect(res.answer).toContain('Pasien Bunda Dewi jam 10:00 WIB bersama Bidan Thabita');
    expect(res.answer).toContain('Semua jadwal sudah terkonfirmasi dengan rapi.');
  });
});
