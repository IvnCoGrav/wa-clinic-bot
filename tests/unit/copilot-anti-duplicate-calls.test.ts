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
  getLlmEndpointConfig: () => ({
    model: 'test',
    fallbackModel: 'test',
    baseUrl: 'http://test',
    apiKey: 'key',
    timeoutMs: 5000,
  }),
}));

import { copilotService, normalizeToolSignature } from '../../src/services/copilot/copilot.service';

function llmReply(content: string) {
  return { data: { choices: [{ message: { content } }] } };
}

describe('Copilot anti duplicate tool calls (Fase 10 & 13 - Menutup V12 & N3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.reservationFindMany.mockResolvedValue([]);
    h.conversationFindMany.mockResolvedValue([]);
    h.messageFindFirst.mockResolvedValue(null);
  });

  it('normalizeToolSignature menyortir keys dan membuang value kosong/undefined/null', () => {
    const sig1 = normalizeToolSignature('query_reservations_by_filter', { date: '2026-11-04', staffName: 'Yusi' });
    const sig2 = normalizeToolSignature('query_reservations_by_filter', { staffName: 'Yusi', date: '2026-11-04' });
    expect(sig1).toBe(sig2);

    const sigWithEmpty = normalizeToolSignature('query_reservations_by_filter', {
      date: '2026-11-04',
      staffName: 'Yusi',
      status: undefined,
      paymentStatus: null,
      extra: '',
    });
    expect(sigWithEmpty).toBe(sig1);
  });

  it('menghentikan router loop bila memanggil tool+args ekuivalen dua kali (anti-loop)', async () => {
    // Step 1: router panggil query_reservations_by_filter dengan { date: '2026-11-04' }
    h.callChat.mockResolvedValueOnce(
      llmReply('{"tool":"query_reservations_by_filter","args":{"date":"2026-11-04"}}')
    );
    // Step 2: router mencoba panggil ulang dengan urutan terbalik / parameter kosong
    h.callChat.mockResolvedValueOnce(
      llmReply('{"tool":"query_reservations_by_filter","args":{"staffName":"", "date":"2026-11-04"}}')
    );
    // Step 3: summarize
    h.callChat.mockResolvedValueOnce(llmReply('Berikut rangkumannya.'));

    h.reservationFindMany.mockResolvedValue([
      {
        id: 'r1',
        booking_date: new Date('2026-11-04T08:00:00Z'),
        status: 'confirmed',
        customer: { id: 'c1', name: 'Bunda Sarah', phone: '6281234567801' },
      },
    ]);

    const res = await copilotService.chat({ tenantId: 'tenant-test', message: 'jadwal hari ini' });
    expect(res.success).toBe(true);
    // Prisma hanya dipanggil SATU kali, bukan dua kali
    expect(h.reservationFindMany).toHaveBeenCalledTimes(1);
    expect(res.toolsUsed).toEqual(['query_reservations_by_filter']);
  });

  it('N3: tool yang sama dengan ARGUMEN BERBEDA tetap diizinkan dieksekusi (anti-false-blocking)', async () => {
    // Step 1: router panggil query_reservations_by_filter dengan date '2026-11-04' (misal 0 baris)
    h.callChat.mockResolvedValueOnce(
      llmReply('{"tool":"query_reservations_by_filter","args":{"date":"2026-11-04"}}')
    );
    // Step 2: router panggil LAGI tool yang sama dengan date '2026-11-05' (argumen berbeda)
    h.callChat.mockResolvedValueOnce(
      llmReply('{"tool":"query_reservations_by_filter","args":{"date":"2026-11-05"}}')
    );
    // Step 3: router selesai (null)
    h.callChat.mockResolvedValueOnce(
      llmReply('{"tool":null,"args":{}}')
    );
    // Step 4: summarize
    h.callChat.mockResolvedValueOnce(llmReply('Berikut rangkuman untuk 5 Nov.'));

    h.reservationFindMany
      .mockResolvedValueOnce([]) // 2026-11-04: 0 baris
      .mockResolvedValueOnce([   // 2026-11-05: 1 baris
        {
          id: 'r2',
          booking_date: new Date('2026-11-05T08:00:00Z'),
          status: 'confirmed',
          customer: { id: 'c2', name: 'Bunda Dewi', phone: '6281234567802' },
        },
      ]);

    const res = await copilotService.chat({ tenantId: 'tenant-test', message: 'jadwal 4 dan 5 Nov' });
    expect(res.success).toBe(true);
    // Keduanya berhasil dipanggil karena argumennya berbeda (N3 beres)
    expect(h.reservationFindMany).toHaveBeenCalledTimes(2);
    expect(res.toolsUsed).toEqual(['query_reservations_by_filter', 'query_reservations_by_filter']);
  });
});
