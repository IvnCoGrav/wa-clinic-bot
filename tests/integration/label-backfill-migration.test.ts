import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { customerService } from '../../src/services/customer.service';
import { queueService } from '../../src/services/queue.service';
import { wahaClient } from '../../src/integrations/waha/client';
import { runBackfillCustomerLabels } from '../../scripts/backfill-customer-labels';
import { FastifyInstance } from 'fastify';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Stage 5: Label Backfill & Safety Migration (TC 41 - 44)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    process.env.ADMIN_API_KEY = 'test_admin_key_123';
    process.env.ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER = 'false';
    await seedAiScopeAll();
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  function messagePayload(waMessageId: string, phone: string, body = 'halo') {
    return {
      event: 'message',
      session: 'default',
      payload: {
        id: waMessageId,
        from: `${phone}@c.us`,
        fromMe: false,
        timestamp: Math.floor(Date.now() / 1000),
        body,
      },
    };
  }

  it('[TC 41] Existing customer dengan labels_synced_at=null → webhook pertama wajib memanggil fallback getChatLabels', async () => {
    const phone = `6286661${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Unsynced Customer', DEFAULT_TENANT_ID);
    
    // Simulate legacy DB customer migrated with labels_synced_at = null
    customer.labels_synced_at = null;

    wahaClient.mockLabels.set(`${phone}@c.us`, ['hold']);
    const getLabelsSpy = vi.spyOn(wahaClient, 'getChatLabelsOrNull');

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: messagePayload(`msg_tc41_${Date.now()}`, phone),
    });

    expect(res.statusCode).toBe(200);
    // Karena labels_synced_at null, fast-path DIBATALKAN dan memanggil getChatLabelsOrNull ke WAHA
    expect(getLabelsSpy).toHaveBeenCalledWith(`${phone}@c.us`);


    // Dan labels_synced_at sekarang diisi
    const refreshed = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
    expect(refreshed.labels_synced_at).not.toBeNull();
    expect(refreshed.is_hold_labeled).toBe(true);

    getLabelsSpy.mockRestore();
    wahaClient.mockLabels.delete(`${phone}@c.us`);
  });

  it('[TC 42] Existing customer yang di-hold di WAHA → setelah fallback, is_hold_labeled ter-sync dan bot tetap silent', async () => {
    const phone = `6286662${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Unsynced Hold Customer', DEFAULT_TENANT_ID);
    customer.labels_synced_at = null;
    wahaClient.mockLabels.set(`${phone}@c.us`, ['hold']);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: messagePayload(`msg_tc42_${Date.now()}`, phone),
    });

    expect(res.statusCode).toBe(200);
    const refreshed = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
    expect(refreshed.is_hold_labeled).toBe(true);
    expect(refreshed.labels_synced_at).not.toBeNull();

    wahaClient.mockLabels.delete(`${phone}@c.us`);
  });

  it('[TC 43] Customer baru pasca-migrasi → labels_synced_at langsung terisi new Date() dan menggunakan fast-path', async () => {
    const phone = `6286663${Date.now()}`;
    const newCust = await customerService.getOrCreateCustomer(phone, 'New Customer Post Migration', DEFAULT_TENANT_ID);
    expect(newCust.labels_synced_at).not.toBeNull();

    const getLabelsSpy = vi.spyOn(wahaClient, 'getChatLabels');
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: messagePayload(`msg_tc43_${Date.now()}`, phone),
    });

    expect(res.statusCode).toBe(200);
    // Customer baru langsung fast-path, TIDAK memanggil getChatLabels
    expect(getLabelsSpy).not.toHaveBeenCalled();

    getLabelsSpy.mockRestore();
  });

  it('[TC 44] Script Backfill → memproses customer dengan labels_synced_at=null dan meng-update DB secara aman', async () => {
    const phone = `6286664${Date.now()}`;
    const cust = await customerService.getOrCreateCustomer(phone, 'Backfill Target', DEFAULT_TENANT_ID);
    cust.labels_synced_at = null;
    wahaClient.mockLabels.set(`${phone}@c.us`, ['Admin']);

    const res = await runBackfillCustomerLabels({ batchSize: 10 });
    expect(res.totalProcessed).toBeGreaterThanOrEqual(1);

    const refreshed = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
    expect(refreshed.labels_synced_at).not.toBeNull();
    expect(refreshed.is_admin_labeled).toBe(true);

    wahaClient.mockLabels.delete(`${phone}@c.us`);
  });

  it('[TC 45] WAHA error/timeout (getChatLabelsOrNull returns null) → labels_synced_at TETAP null', async () => {
    const phone = `6286665${Date.now()}`;
    const cust = await customerService.getOrCreateCustomer(phone, 'WAHA Down Customer', DEFAULT_TENANT_ID);
    cust.labels_synced_at = null;

    // Spy getChatLabelsOrNull to return null (simulating WAHA down)
    const spy = vi.spyOn(wahaClient, 'getChatLabelsOrNull').mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: messagePayload(`msg_tc45_${Date.now()}`, phone),
    });

    expect(res.statusCode).toBe(200);
    const refreshed = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
    // Karena WAHA return null (gagal), labels_synced_at TIDAK BOLEH di-mark synced
    expect(refreshed.labels_synced_at).toBeNull();

    spy.mockRestore();
  });

  it('[TC 46] Backfill Script saat WAHA down (returns null) → melewati customer tanpa menyetel labels_synced_at', async () => {
    const phone = `6286666${Date.now()}`;
    const cust = await customerService.getOrCreateCustomer(phone, 'Backfill Fail Target', DEFAULT_TENANT_ID);
    cust.labels_synced_at = null;

    const spy = vi.spyOn(wahaClient, 'getChatLabelsOrNull').mockImplementation(async (chatId) => {
      if (chatId.includes(phone)) return null;
      return [];
    });

    await runBackfillCustomerLabels({ batchSize: 10 });

    const refreshed = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
    expect(refreshed.labels_synced_at).toBeNull();

    spy.mockRestore();
  });

});

