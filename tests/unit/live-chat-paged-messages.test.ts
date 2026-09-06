import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { messageService } from '../../src/services/message.service';
import { FastifyInstance } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const ADMIN_KEY = 'test_admin_key_paged';

describe('Live Chat Cursor Pagination Pesan (infinite scroll up)', () => {
  let app: FastifyInstance;
  let conversationId: string;
  const bodies = ['pesan satu', 'pesan dua', 'pesan tiga', 'pesan empat', 'pesan lima'];

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = buildApp();
    await app.ready();

    const phone = `628700${Date.now().toString().slice(-7)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Paged', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    conversationId = conversation.id;

    const base = Date.now() - 60000;
    for (let i = 0; i < bodies.length; i++) {
      await messageService.logMessage({
        tenantId: DEFAULT_TENANT_ID,
        conversationId,
        direction: i % 2 === 0 ? 'INBOUND' : 'OUTBOUND',
        content: bodies[i],
        senderType: i % 2 === 0 ? 'CUSTOMER' : 'ADMIN',
        createdAt: new Date(base + i * 1000),
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const getMsgs = async (qs = '') => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/live-chat/conversations/${conversationId}/messages${qs}`,
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  };

  it('tanpa param: struktur legacy + seluruh pesan kronologis', async () => {
    const body = await getMsgs();
    expect(body.success).toBe(true);
    expect(body.count).toBe(5);
    expect(body.hasMore).toBe(false);
    expect(body.oldestCursor).toBeTruthy();
    expect(body.data.map((m: any) => m.content)).toEqual(bodies);
  });

  it('limit=2: batch1 = 2 terbaru + hasMore true + oldestCursor', async () => {
    const body = await getMsgs('?limit=2');
    expect(body.count).toBe(2);
    expect(body.hasMore).toBe(true);
    expect(body.data.map((m: any) => m.content)).toEqual(['pesan empat', 'pesan lima']);
    expect(body.oldestCursor).toBeTruthy();
  });

  it('before=cursor: batch berurutan hingga habis + hasMore false', async () => {
    const b1 = await getMsgs('?limit=2');
    const b2 = await getMsgs(`?limit=2&before=${encodeURIComponent(b1.oldestCursor)}`);
    expect(b2.count).toBe(2);
    expect(b2.hasMore).toBe(true);
    expect(b2.data.map((m: any) => m.content)).toEqual(['pesan dua', 'pesan tiga']);

    const b3 = await getMsgs(`?limit=2&before=${encodeURIComponent(b2.oldestCursor)}`);
    expect(b3.count).toBe(1);
    expect(b3.hasMore).toBe(false);
    expect(b3.data.map((m: any) => m.content)).toEqual(['pesan satu']);

    // Gabungan batch tetap kronologis lama -> baru
    const combined = [...b3.data, ...b2.data, ...b1.data].map((m: any) => m.content);
    expect(combined).toEqual(bodies);
  });

  it('limit divalidasi (min 1, maks 200)', async () => {
    const body = await getMsgs('?limit=9999');
    expect(body.count).toBe(5);
    expect(body.hasMore).toBe(false);
  });
});
