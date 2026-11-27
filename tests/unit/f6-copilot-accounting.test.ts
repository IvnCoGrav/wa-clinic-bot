import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  callChat: vi.fn(),
  conversationFindMany: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  prisma: {
    conversation: { findMany: h.conversationFindMany },
  },
}));

vi.mock('../../src/integrations/llm/model-fallback', () => ({
  callChatCompletionsWithFallback: (...a: any[]) => h.callChat(...a),
}));

vi.mock('../../src/integrations/llm/llm-gateway', () => ({
  getLlmEndpointConfig: () => ({
    model: 'test-model',
    fallbackModel: 'test-model',
    baseUrl: 'http://llm.test',
    apiKey: 'test-key',
    timeoutMs: 3000,
  }),
}));

import { copilotService, buildDegradedAnswer } from '../../src/services/copilot/copilot.service';

function conversationRow() {
  return [
    {
      id: 'conv-1',
      customer: { id: 'cust-1', name: 'Sari', phone: '628111222333' },
      messages: [
        {
          direction: 'INBOUND',
          content: 'saya mau tanya jadwal',
          created_at: new Date().toISOString(),
        },
      ],
    },
  ];
}

/** Router (temperature 0) → tool; summarize → teks; lanjutan (max_tokens 600) → teks. */
function scriptedLlm(opts: { finishLength?: boolean } = {}) {
  h.callChat.mockImplementation(async (args: any) => {
    const payload = args?.payload || {};
    const first = String(payload.messages?.[0]?.content || '');
    if (/tools?|TOOLS/i.test(first) && payload.temperature === 0) {
      return {
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({ tool: 'query_unreplied_chats', args: {} }),
              },
            },
          ],
        },
      };
    }
    if (payload.max_tokens === 600) {
      return { data: { choices: [{ message: { content: 'Belum dibalas sejak pagi.' } }] } };
    }
    return {
      data: {
        choices: [
          {
            message: { content: 'Ada 1 chat yang belum dibalas.' },
            finish_reason: opts.finishLength ? 'length' : 'stop',
          },
        ],
      },
    };
  });
}

describe('F6 — akuntansi token Copilot (anti-bocor anggaran)', () => {
  beforeEach(() => {
    h.callChat.mockReset();
    h.conversationFindMany.mockReset();
    h.conversationFindMany.mockResolvedValue(conversationRow());
  });

  afterEach(() => {
    delete process.env.COPILOT_MAX_TOKENS_PER_TURN;
    vi.restoreAllMocks();
  });

  it('provider tanpa usage → token tetap dihitung (estimasi deterministik, bukan 0)', async () => {
    scriptedLlm();
    const res = await copilotService.chat({ tenantId: 'default-tenant', message: 'siapa yang belum dibalas?' });

    expect(res.success).toBe(true);
    expect(res.toolsUsed).toContain('query_unreplied_chats');
    expect(res.tokensUsed).toBeGreaterThan(0);
    expect(res.llmCalls).toBeGreaterThanOrEqual(2);
  });

  it('panggilan lanjutan (finish_reason=length) ikut tercatat ke akuntansi', async () => {
    scriptedLlm({ finishLength: true });
    const res = await copilotService.chat({ tenantId: 'default-tenant', message: 'ringkas chat menggantung' });

    expect(res.success).toBe(true);
    // router → router (langkah lanjutan) → summarize → lanjutan (finish_reason=length)
    expect(res.llmCalls).toBe(4);
    expect(h.callChat.mock.calls.some((c: any[]) => c[0]?.payload?.max_tokens === 600)).toBe(true);
    expect(res.tokensUsed).toBeGreaterThan(0);
  });

  it('jawaban degradasi menetralkan tautan markdown dari pesan pelanggan', () => {
    const out = buildDegradedAnswer([
      {
        tool: 'query_unreplied_chats',
        rows: [
          {
            customerName: '[Klik hadiah](https://evil.example/promo)',
            lastMessage: '[Ambil voucher](https://evil.example/v)',
          },
        ],
      },
    ]);

    // Label tetap tampil sebagai teks, target tautan tidak pernah masuk output.
    expect(out).toContain('Klik hadiah');
    expect(out).toContain('Ambil voucher');
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('](http');
  });

  it('plafon token per turn menghentikan loop dan menyajikan data mentah (bukan error)', async () => {
    process.env.COPILOT_MAX_TOKENS_PER_TURN = '1';
    scriptedLlm();
    const res = await copilotService.chat({ tenantId: 'default-tenant', message: 'siapa yang belum dibalas?' });

    expect(res.success).toBe(true);
    expect(res.toolsUsed).toContain('query_unreplied_chats');
    // Berhenti sebelum summarize → hanya 1 panggilan LLM.
    expect(res.llmCalls).toBe(1);
    expect(typeof res.grounded).toBe('boolean');
  });
});
