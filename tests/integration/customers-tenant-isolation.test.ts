import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { FastifyInstance } from 'fastify';
import { queueService } from '../../src/services/queue.service';
import { customerService } from '../../src/services/customer.service';

const ADMIN_KEY = 'test_admin_key_tenant_isolation';
const DEFAULT_HEADERS = { 'x-api-key': ADMIN_KEY };
const TENANT_B_HEADERS = { 'x-api-key': ADMIN_KEY, 'x-tenant-id': 'tenant-b' };

describe('Customer Admin Subroute - Tenant Isolation (A-013)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  it('GET /api/admin/customers meneruskan tenantId dari x-tenant-id', async () => {
    const spy = vi.spyOn(customerService, 'listCustomersWithLtvAndAdClick').mockResolvedValueOnce({
      customers: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers',
      headers: TENANT_B_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('tenant-b', expect.any(Object));
  });

  it('GET /api/admin/customers jatuh ke default-tenant jika tanpa x-tenant-id', async () => {
    const spy = vi.spyOn(customerService, 'listCustomersWithLtvAndAdClick').mockResolvedValueOnce({
      customers: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers',
      headers: DEFAULT_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('default-tenant', expect.any(Object));
  });

  it('GET /api/admin/customers/:id memfilter customer sesuai tenant_id', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValueOnce({
      id: 'cust-b',
      tenant_id: 'tenant-b',
      name: 'Customer B',
      phone: '628111111111',
      reservations: [],
      children: [],
      labels: [],
      adClick: null,
      follow_ups: [],
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers/cust-b',
      headers: TENANT_B_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const call = vi.mocked(prisma.customer.findFirst).mock.calls.at(-1)![0] as any;
    expect(call.where.id).toBe('cust-b');
    expect(call.where.tenant_id).toBe('tenant-b');
  });

  it('GET /api/admin/customers/:id/messages memfilter conversation & message sesuai tenant_id', async () => {
    vi.mocked(prisma.conversation.findMany).mockResolvedValueOnce([
      { id: 'conv-b', customer_id: 'cust-b', tenant_id: 'tenant-b' },
    ] as any);
    vi.mocked(prisma.message.findMany).mockResolvedValueOnce([
      { id: 'msg-1', conversation_id: 'conv-b', tenant_id: 'tenant-b', content: 'Halo' },
    ] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers/cust-b/messages',
      headers: TENANT_B_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const convCall = vi.mocked(prisma.conversation.findMany).mock.calls.at(-1)![0] as any;
    expect(convCall.where.customer_id).toBe('cust-b');
    expect(convCall.where.tenant_id).toBe('tenant-b');

    const msgCall = vi.mocked(prisma.message.findMany).mock.calls.at(-1)![0] as any;
    expect(msgCall.where.conversation_id).toEqual({ in: ['conv-b'] });
    expect(msgCall.where.tenant_id).toBe('tenant-b');
  });

  it('GET /api/admin/customers/:id/active-reservations memfilter tenant_id', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers/cust-b/active-reservations',
      headers: TENANT_B_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const resCall = vi.mocked(prisma.reservation.findMany).mock.calls.at(-1)![0] as any;
    expect(resCall.where.customer_id).toBe('cust-b');
    expect(resCall.where.tenant_id).toBe('tenant-b');
  });

  it('POST /api/admin/customer/:id/block meneruskan tenantId', async () => {
    const spy = vi.spyOn(customerService, 'blockCustomer').mockResolvedValueOnce({
      id: 'cust-b',
      is_blocked: true,
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/customer/cust-b/block',
      headers: TENANT_B_HEADERS,
      payload: { reason: 'Spam test' },
    });

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('cust-b', 'Spam test', 'tenant-b');
  });
});
