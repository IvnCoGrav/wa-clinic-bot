import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { FastifyInstance } from 'fastify';

describe('Admin Labels CRUD & Customer Label Assignment (Offline Fallback)', () => {
  let app: FastifyInstance;
  const adminKey = 'test-admin-key-labels';

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = adminKey;
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. GET /api/admin/labels harus mengembalikan array label', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/labels',
      headers: { 'x-api-key': adminKey },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('2. POST /api/admin/labels membuat label baru', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/labels',
      headers: { 'x-api-key': adminKey },
      payload: {
        name: 'VIP Moms Test',
        color: '#db2777',
      },
    });

    expect([200, 201]).toContain(res.statusCode);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('VIP Moms Test');
    expect(body.data.color).toBe('#db2777');
  });

  it('3. POST /api/admin/customers/:id/labels assign label ke customer', async () => {
    const customerId = 'cust_test_123';
    const labelId = 'lbl_test_456';

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/customers/${customerId}/labels`,
      headers: { 'x-api-key': adminKey },
      payload: {
        labelId,
        action: 'add',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
  });
});
