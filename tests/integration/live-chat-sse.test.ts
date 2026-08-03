import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { buildApp } from '../../src/app';
import { messageService } from '../../src/services/message.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { FastifyInstance } from 'fastify';

const ADMIN_KEY = 'test_admin_key_sse';

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}

describe('Live Chat SSE Events', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/admin/live-chat/events tanpa autentikasi → 401 (fail-closed)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/live-chat/events',
    });
    expect(res.statusCode).toBe(401);
  });

  it('SSE menerima event message.created secara real-time', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/api/admin/live-chat/events`;

    const chunks: string[] = [];
    let statusCode = 0;
    let contentType = '';

    const clientReq = http.get(url, { headers: { 'x-api-key': ADMIN_KEY } }, (res) => {
      statusCode = res.statusCode || 0;
      contentType = res.headers['content-type'] || '';
      res.on('data', (chunk) => chunks.push(chunk.toString()));
    });
    clientReq.on('error', () => {});

    // Beri waktu subscribe hub selesai, lalu publish beberapa kali agar tidak rawan race
    await new Promise((r) => setTimeout(r, 200));
    for (let i = 0; i < 3; i++) {
      await messageService.logMessage({
        tenantId: DEFAULT_TENANT_ID,
        conversationId: 'conv_sse_test',
        direction: 'OUTBOUND',
        content: `Pesan uji SSE ke-${i}`,
        senderType: 'ADMIN',
        senderName: 'Admin',
      });
      await new Promise((r) => setTimeout(r, 30));
    }

    const arrived = await waitFor(() => chunks.join('').includes('event: message.created'), 4000);

    expect(statusCode).toBe(200);
    expect(contentType).toContain('text/event-stream');
    expect(arrived).toBe(true);

    const body = chunks.join('');
    expect(body).toContain('retry: 3000');
    expect(body).toContain('event: message.created');
    expect(body).toContain('data: {"conversationId":"conv_sse_test"');
    expect(body).toContain('Pesan uji SSE ke-0');
    expect(body).toContain('"senderType":"ADMIN"');

    // Tutup koneksi klien; tunggu server melepas socket sebelum app.close()
    const closedPromise = new Promise<void>((resolve) => clientReq.once('close', () => resolve()));
    clientReq.destroy();
    await Promise.race([closedPromise, new Promise((r) => setTimeout(r, 1000))]);
  });
});
