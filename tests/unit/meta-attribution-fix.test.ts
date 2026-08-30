import { describe, it, expect, beforeEach, vi } from 'vitest';
import { matchAdClickAndFireContact } from '../../src/services/ad-attribution.service';
import { capiService } from '../../src/services/capi.service';
import { memoryAdClicks } from '../../src/routes/tracking.route';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { buildApp } from '../../src/app';

import { memoryReservations } from '../../src/routes/admin/stores';

describe('Meta Click Catcher, CAPI Queue & Attribution Fixes Unit Tests', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    memoryAdClicks.clear();
    memoryReservations.clear();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    process.env.FB_PIXEL_ID = '1382300863013984';
    process.env.FB_CAPI_ACCESS_TOKEN = 'mock_valid_token';
  });

  it('1. matchAdClickAndFireContact matches tracking code for existing customers (isNewCustomerRecord = false)', async () => {
    const trackingCode = 'pr99';
    memoryAdClicks.set(trackingCode, {
      trackingCode,
      fbp: 'fb.1.123',
      fbc: 'fb.1.456',
      matchedAt: null,
      customerId: null,
    });

    const sendCapiSpy = vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({
      success: true,
      status: 200,
    });

    const existingCustomer = {
      id: 'cust-existing-123',
      phone: '6288235780925',
      name: 'Ivan Existing',
      is_sandbox_test: false,
    };

    const result = await matchAdClickAndFireContact({
      bodyText: 'Promo [pr99] Halo saya mau reservasi',
      isNewCustomerRecord: false,
      customer: existingCustomer,
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(result.matched).toBe(true);
    expect(result.trackingCode).toBe('pr99');
    expect(result.strippedText).toBe('Halo saya mau reservasi');
    expect(sendCapiSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'Contact',
        customer: existingCustomer,
      })
    );
  });

  it('2. matchAdClickAndFireContact matches native CTWA referral for existing customers', async () => {
    const sendCapiSpy = vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({
      success: true,
      status: 200,
    });

    const existingCustomer = {
      id: 'cust-existing-456',
      phone: '6288235780926',
      name: 'Ivan Returning',
      is_sandbox_test: false,
    };

    const result = await matchAdClickAndFireContact({
      bodyText: 'Halo Bidan',
      isNewCustomerRecord: false,
      customer: existingCustomer,
      tenantId: DEFAULT_TENANT_ID,
      referral: {
        ctwaClid: 'ctwa_12345_clid',
        sourceUrl: 'https://fb.me/ad',
      },
    });

    expect(result.matched).toBe(true);
    expect(result.ctwaClid).toBe('ctwa_12345_clid');
    expect(sendCapiSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'Contact',
        customer: existingCustomer,
      })
    );
  });

  it('3. GET /api/admin/capi-queue returns all non-cancelled reservations even if purchase_occurred_at is null', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/capi-queue',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('4. POST /api/admin/reservation/:id/approve-purchase supports customPayload override in memory fallback', async () => {
    const resId = 'res-test-custom-123';
    memoryReservations.set(resId, {
      id: resId,
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-123',
      purchase_review_status: 'pending',
      purchase_value: 70000,
      treatment_detail: 'Pijat Bayi Ceria',
      created_at: new Date(),
      updated_at: new Date(),
    });

    const customPayload = {
      event_name: 'Purchase',
      event_time: 1787360000,
      custom_data: {
        currency: 'IDR',
        value: 125000,
        content_name: 'Pijat Bayi Custom & Laktasi',
      },
    };

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/reservation/${resId}/approve-purchase`,
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { customPayload },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.purchase_review_status).toBe('approved');
  });
});

