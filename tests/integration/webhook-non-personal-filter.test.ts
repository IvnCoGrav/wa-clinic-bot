import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { queueService } from '../../src/services/queue.service';
import { customerService } from '../../src/services/customer.service';
import { FastifyInstance } from 'fastify';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Webhook Filter JID Non-Personal (broadcast/status/newsletter)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    await seedAiScopeAll();
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  const buildPayload = (from: string, id?: string) => ({
    event: 'message',
    session: 'default',
    payload: {
      id: id || `msg_nonpersonal_${Date.now()}`,
      from,
      fromMe: false,
      timestamp: 1700000000,
      body: 'halo',
      _data: { notifyName: 'Status Viewer' },
    },
  });

  it('status@broadcast → IGNORED_NON_PERSONAL dan TIDAK membuat customer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: buildPayload('status@broadcast'),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'IGNORED_NON_PERSONAL' });

    const cust = await customerService.getCustomerByPhone('status', DEFAULT_TENANT_ID);
    expect(cust).toBeNull();
  });

  it('@newsletter → IGNORED_NON_PERSONAL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: buildPayload('120363123456789@newsletter'),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'IGNORED_NON_PERSONAL' });
  });

  it('@g.us tetap IGNORED_GROUP_MESSAGE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: buildPayload('628123456789-123456@g.us'),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'IGNORED_GROUP_MESSAGE' });
  });

  it('JID tanpa user part (@c.us) → IGNORED_NO_PHONE (cegah customer ber-phone kosong)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: buildPayload('@c.us'),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'IGNORED_NO_PHONE' });
  });
});
