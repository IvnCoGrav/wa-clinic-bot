import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { customerService } from '../../src/services/customer.service';
import { queueService } from '../../src/services/queue.service';
import { wahaClient } from '../../src/integrations/waha/client';
import { FastifyInstance } from 'fastify';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const ADMIN_KEY = 'test_admin_key_123';
const ADMIN_HEADERS = { 'x-api-key': ADMIN_KEY };

/**
 * Task: admin-dashboard membaca & men-toggle label WhatsApp (admin/hold)
 * via kolom DB Customer.is_admin_labeled / is_hold_labeled.
 * Cover: GET list memuat flag label, PATCH /api/admin/customers/:id/label
 * meng-update kolom DB (sumber kebenaran) + mirror ke WAHA (best-effort).
 */
describe('Admin Customer Label (DB-column) API', () => {
  let app: FastifyInstance;
  const phone = `6285551${Date.now()}`;
  let customerId: string;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    process.env.ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER = 'false';
    await seedAiScopeAll();
    app = buildApp();
    await app.ready();
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Label API', DEFAULT_TENANT_ID);
    customerId = customer.id;
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  it('GET /api/admin/customers → memuat kolom isAdminLabeled/isHoldLabeled (default false)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/customers?search=${phone}`,
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    const found = body.customers.find((c: any) => c.phone === phone);
    expect(found).toBeDefined();
    expect(found.isAdminLabeled).toBe(false);
    expect(found.isHoldLabeled).toBe(false);
  });

  it('PATCH :id/label { label: hold, enabled: true } → kolom DB true + mirror ke WAHA', async () => {
    const addSpy = vi.spyOn(wahaClient, 'addLabel');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/customers/${customerId}/label`,
      headers: ADMIN_HEADERS,
      payload: { label: 'hold', enabled: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.wahaOk).toBe(true);

    const refreshed = await customerService.getCustomerById(customerId, DEFAULT_TENANT_ID);
    expect(refreshed.is_hold_labeled).toBe(true);

    // Mirror WAHA benar: label 'hold' dipanggil dengan jid @c.us
    expect(addSpy).toHaveBeenCalledWith(`${phone}@c.us`, 'hold');
    addSpy.mockRestore();
  });

  it('PATCH :id/label { label: hold, enabled: false } → kolom DB false + removeLabel dipanggil', async () => {
    const removeSpy = vi.spyOn(wahaClient, 'removeLabel');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/customers/${customerId}/label`,
      headers: ADMIN_HEADERS,
      payload: { label: 'hold', enabled: false },
    });
    expect(res.statusCode).toBe(200);

    const refreshed = await customerService.getCustomerById(customerId, DEFAULT_TENANT_ID);
    expect(refreshed.is_hold_labeled).toBe(false);
    expect(removeSpy).toHaveBeenCalledWith(`${phone}@c.us`, 'hold');
    removeSpy.mockRestore();
  });

  it('PATCH :id/label { label: admin, enabled: true } → kolom is_admin_labeled=true', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/customers/${customerId}/label`,
      headers: ADMIN_HEADERS,
      payload: { label: 'admin', enabled: true },
    });
    expect(res.statusCode).toBe(200);

    const refreshed = await customerService.getCustomerById(customerId, DEFAULT_TENANT_ID);
    expect(refreshed.is_admin_labeled).toBe(true);
  });

  it('validasi: label tidak dikenal / enabled bukan boolean → 400', async () => {
    const badLabel = await app.inject({
      method: 'PATCH',
      url: `/api/admin/customers/${customerId}/label`,
      headers: ADMIN_HEADERS,
      payload: { label: 'spam', enabled: true },
    });
    expect(badLabel.statusCode).toBe(400);

    const badEnabled = await app.inject({
      method: 'PATCH',
      url: `/api/admin/customers/${customerId}/label`,
      headers: ADMIN_HEADERS,
      payload: { label: 'hold', enabled: 'yes' },
    });
    expect(badEnabled.statusCode).toBe(400);
  });

  it('customer tidak ditemukan → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/customers/00000000-0000-0000-0000-000000000000/label',
      headers: ADMIN_HEADERS,
      payload: { label: 'hold', enabled: true },
    });
    expect(res.statusCode).toBe(404);
  });
});
