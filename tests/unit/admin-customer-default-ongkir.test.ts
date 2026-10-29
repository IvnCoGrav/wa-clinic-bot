import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { customerAdminRoutes } from '../../src/routes/admin/customers.subroute';
import { customerService } from '../../src/services/customer.service';

describe('GET /api/admin/customers/:id/default-ongkir', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    app = Fastify();
    await app.register(customerAdminRoutes);
  });

  it('mengembalikan ongkir tervalidasi dari customerService.getLastDeliveryFee', async () => {
    vi.spyOn(customerService, 'getLastDeliveryFee').mockResolvedValueOnce(15000);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers/cust-123/default-ongkir',
      headers: {
        'x-tenant-id': 'tenant-b',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ success: true, ongkir: 15000 });
    expect(customerService.getLastDeliveryFee).toHaveBeenCalledWith('cust-123', 'tenant-b');
  });

  it('mengembalikan 401 fail-closed bila x-tenant-id tidak disertakan', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers/cust-123/default-ongkir',
    });

    expect(res.statusCode).toBe(401);
  });

  it('mengembalikan 500 bila service throw error', async () => {
    vi.spyOn(customerService, 'getLastDeliveryFee').mockRejectedValueOnce(new Error('DB failure'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers/cust-err/default-ongkir',
      headers: {
        'x-tenant-id': 'tenant-b',
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().success).toBe(false);
  });
});
