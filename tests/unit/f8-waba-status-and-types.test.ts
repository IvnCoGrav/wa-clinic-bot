import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { buildApp } from '../../src/app';
import { wabaTenantService } from '../../src/services/waba-tenant.service';
import { messageService } from '../../src/services/message.service';
import { queueService } from '../../src/services/queue.service';
import { normalizeWabaPayload, buildWabaCanonicalContent } from '../../src/integrations/whatsapp/normalizer';

/**
 * F8 — determinisme ingress WABA:
 * M02-10: status dengan phone_number_id tak dikenal tidak boleh 500 / membatalkan batch.
 * M02-13: tipe button/order/system/unsupported dipetakan eksplisit (bukan `unknown` → `[IMAGE]`).
 */

const APP_SECRET = 'f8_meta_app_secret';

function sign(body: string): string {
  return `sha256=${crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
}

describe('F8 — WABA status & tipe pesan', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    wabaTenantService.resetCache();
    process.env.WABA_APP_SECRET = APP_SECRET;
  });

  it('status untuk phone_number_id tak dikenal diabaikan; status lain tetap diproses (200)', async () => {
    vi.spyOn(wabaTenantService, 'resolveTenantByPhoneNumberId').mockImplementation(async (id: any) => {
      if (id === 'PNID_UNKNOWN') throw new Error('UNKNOWN_PHONE_NUMBER_ID');
      return 'tenant-status-ok';
    });
    const updateSpy = vi.spyOn(messageService, 'updateDeliveryStatus').mockResolvedValue({ matched: true } as any);

    // Dua entry dengan phone_number_id berbeda: satu tak dikenal, satu valid.
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'e1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '6280000', phone_number_id: 'PNID_UNKNOWN' },
                statuses: [{ id: 'wamid.unknown', status: 'delivered', timestamp: '1691000100' }],
              },
            },
          ],
        },
        {
          id: 'e2',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '6281234', phone_number_id: 'PNID_KNOWN' },
                statuses: [{ id: 'wamid.known', status: 'read', timestamp: '1691000200' }],
              },
            },
          ],
        },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('STATUS_PROCESSED');
    expect(res.json().count).toBe(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      'wamid.known',
      'tenant-status-ok',
      'read',
      expect.anything(),
      null,
      null,
      null
    );
  });

  it('system/unsupported dicatat untuk audit tapi TIDAK diantrekan ke bot', async () => {
    vi.spyOn(wabaTenantService, 'resolveTenantByPhoneNumberId').mockResolvedValue('tenant-types');
    const logSpy = vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);
    const queueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);

    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'e1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '6281', phone_number_id: 'PNID' },
                contacts: [{ profile: { name: 'Bunda Uji' }, wa_id: '628112' }],
                messages: [
                  {
                    id: 'sys-1',
                    from: '628112',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'system',
                    system: { body: 'Nomor pelanggan berubah', type: 'customer_changed_number' },
                  },
                  {
                    id: 'unsup-1',
                    from: '628112',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'unsupported',
                    errors: [{ code: 131051 }],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });

    expect(res.statusCode).toBe(200);
    expect(queueSpy).not.toHaveBeenCalled();
    const contents = logSpy.mock.calls.map((c: any[]) => String(c[0]?.content || ''));
    expect(contents.some((c) => c.includes('[SYSTEM:'))).toBe(true);
    expect(contents.some((c) => c === '[UNSUPPORTED]')).toBe(true);
  });

  it('tipe button/order/system/unsupported dipetakan eksplisit, bukan unknown', () => {
    const payload: any = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'e1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '6281', phone_number_id: 'PNID' },
                contacts: [{ profile: { name: 'Bunda Uji' }, wa_id: '628111' }],
                messages: [
                  { id: 'w1', from: '628111', timestamp: '1700000000', type: 'button', button: { text: 'Ya', payload: 'BTN_YA' } },
                  {
                    id: 'w2',
                    from: '628111',
                    timestamp: '1700000001',
                    type: 'order',
                    order: { catalog_id: 'cat-1', product_items: [{ product_retailer_id: 'sku-1', quantity: 1 }] },
                  },
                  {
                    id: 'w3',
                    from: '628111',
                    timestamp: '1700000002',
                    type: 'system',
                    system: { body: 'Nomor pelanggan berubah', type: 'customer_changed_number' },
                  },
                  { id: 'w4', from: '628111', timestamp: '1700000003', type: 'unsupported', errors: [{ code: 131051 }] },
                ],
              },
            },
          ],
        },
      ],
    };

    const [button, order, system, unsupported] = normalizeWabaPayload(payload, 'default-tenant');

    expect(button.type).toBe('interactive_button');
    expect(button.text).toBe('Ya');
    expect(button.buttonPayload).toEqual({ id: 'BTN_YA', title: 'Ya' });

    expect(order.type).toBe('order');
    expect(order.text).toContain('1 item');

    expect(system.type).toBe('system');
    expect(system.text).toContain('Nomor pelanggan berubah');

    expect(unsupported.type).toBe('unsupported');
    expect(unsupported.text).toBeTruthy();

    // Kontrak audit trail: tidak ada yang jatuh ke label gambar.
    for (const msg of [button, order, system, unsupported]) {
      const content = buildWabaCanonicalContent(msg as any);
      expect(content).not.toBe('[IMAGE]');
      expect(content.length).toBeGreaterThan(0);
    }
    expect(buildWabaCanonicalContent(order as any)).toContain('[ORDER:');
    expect(buildWabaCanonicalContent(system as any)).toContain('[SYSTEM:');
    expect(buildWabaCanonicalContent(unsupported as any)).toBe('[UNSUPPORTED]');
  });
});
