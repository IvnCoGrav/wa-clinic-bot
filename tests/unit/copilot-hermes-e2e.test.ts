import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

/**
 * E2E Copilot ↔ Hermes (otak OpenAI-compatible :8642).
 *
 * Beda dari `copilot-hermes-contract.test.ts` (fetch di-stub) dan
 * `copilot-hermes-adapter.test.ts` (adapter di-mock): file ini menjalankan
 * ADAPTER ASLI dan `copilotService.chat` penuh melawan server HTTP LOKAL yang
 * merekam request di wire. Tujuannya membuktikan secara empiris:
 *   - apakah sistem BENAR-BENAR mengirim POST /v1/chat/completions (bukan hanya GET),
 *   - dengan Bearer key + model + body tepat,
 *   - dan observabilitas engine: hermesFallback=false saat Hermes benar-benar dipakai.
 *
 * Offline penuh (server loopback; DB & LLM internal di-mock).
 */

const h = vi.hoisted(() => ({
  conversationFindMany: vi.fn(),
  callChat: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  prisma: {
    conversation: { findMany: h.conversationFindMany },
    customer: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    reservation: { findMany: vi.fn().mockResolvedValue([]) },
    clinicService: { findMany: vi.fn().mockResolvedValue([]) },
    knowledgeChunk: { findMany: vi.fn().mockResolvedValue([]) },
    clinicPolicy: { findMany: vi.fn().mockResolvedValue([]) },
    tenant: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

// Fallback internal di-mock: bila Hermes gagal, TIDAK menembak network nyata.
vi.mock('../../src/integrations/llm/model-fallback', () => ({
  callChatCompletionsWithFallback: (...a: any[]) => h.callChat(...a),
}));
vi.mock('../../src/integrations/llm/llm-gateway', () => ({
  getLlmEndpointConfig: () => ({ model: 'test', fallbackModel: 'test', baseUrl: 'http://127.0.0.1:9', apiKey: 'k', timeoutMs: 1000 }),
}));

import { copilotService } from '../../src/services/copilot/copilot.service';

interface CapturedReq {
  method: string;
  url: string;
  auth: string;
  body: any;
}

function llmReply(content: string) {
  return { data: { choices: [{ message: { content } }] } };
}

function inboundConv() {
  return [
    {
      id: 'conv-hermes-1',
      last_message_at: new Date(),
      customer: { id: 'u1', name: 'Bunda Rina', phone: '628123000111' },
      messages: [{ direction: 'INBOUND', content: 'assalamualaikum', created_at: new Date() }],
    },
  ];
}

let server: http.Server;
let captured: CapturedReq[] = [];

async function startMockOpenAI(): Promise<number> {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body: any = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
      captured.push({ method: req.method || '', url: req.url || '', auth: String(req.headers['authorization'] || ''), body });

      // Router → putuskan tool; Summarize → teks grounded.
      const prompt: string = body?.messages?.[0]?.content || '';
      const content = /Pilih SATU tool/.test(prompt)
        ? '{"tool":"query_unreplied_chats","args":{"limit":5}}'
        : 'Ada Bunda Rina yang menunggu balasan. [Buka Chat](/admin/live-chat?conversationId=conv-hermes-1)';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

describe('Copilot ↔ Hermes E2E (wire-level, adapter asli)', () => {
  beforeEach(async () => {
    captured = [];
    h.callChat.mockReset().mockResolvedValue(llmReply('INTERNAL FALLBACK'));
    h.conversationFindMany.mockReset().mockResolvedValue(inboundConv());
    const port = await startMockOpenAI();
    process.env.COPILOT_ENGINE = 'hermes';
    process.env.HERMES_BRAIN_MODE = 'openai';
    process.env.HERMES_OPENAI_URL = `http://127.0.0.1:${port}`;
    process.env.HERMES_OPENAI_KEY = 'test-key-123';
    process.env.HERMES_OPENAI_MODEL = 'hermes-agent';
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.COPILOT_ENGINE;
    delete process.env.HERMES_BRAIN_MODE;
    delete process.env.HERMES_OPENAI_URL;
    delete process.env.HERMES_OPENAI_KEY;
    delete process.env.HERMES_OPENAI_MODEL;
  });

  it('mengirim POST /v1/chat/completions + Bearer + model; engine=hermes tanpa fallback', async () => {
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'chat menggantung?' });

    // Bukti wire: POST benar-benar keluar (bukan GET /v1/models).
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const first = captured[0];
    expect(first.method).toBe('POST');
    expect(first.url).toBe('/v1/chat/completions');
    expect(first.auth).toBe('Bearer test-key-123');
    expect(first.body.model).toBe('hermes-agent');
    expect(first.body.messages[0].content).toContain('Pilih SATU tool');

    // Hermes benar-benar dipakai → fallback internal TIDAK disentuh.
    expect(res.engine).toBe('hermes');
    expect(res.hermesFallback).toBe(false);
    expect(h.callChat).not.toHaveBeenCalled();
    expect(res.toolsUsed).toContain('query_unreplied_chats');
  });

  it('tanpa HERMES_OPENAI_KEY → fail-closed: 0 POST, engine=hermes tapi fallback=true', async () => {
    delete process.env.HERMES_OPENAI_KEY;
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'chat menggantung?' });

    expect(captured.length).toBe(0); // tidak ada request keluar sama sekali
    expect(res.engine).toBe('hermes');
    expect(res.hermesFallback).toBe(true);
    expect(h.callChat).toHaveBeenCalled(); // jatuh ke LLM internal
  });

  it('default env (COPILOT_ENGINE tak diisi) → engine=internal, adapter tak disentuh', async () => {
    delete process.env.COPILOT_ENGINE;
    h.callChat.mockResolvedValue(llmReply('{"tool":"query_unreplied_chats","args":{}}'));
    const res = await copilotService.chat({ tenantId: 'tenant-a', message: 'chat menggantung?' });
    expect(res.engine).toBe('internal');
    expect(captured.length).toBe(0);
  });
});
