import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';
import { capiService, capiBreaker } from '../../src/services/capi.service';

describe('Task 2.8 + P0-6 + P0-7: CAPI Delivery Truth & Root testEventCode Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CAPI_STRICT_DELIVERY;
    process.env.FB_PIXEL_ID = 'test_pixel_123';
    process.env.FB_CAPI_ACCESS_TOKEN = 'test_token_123';
  });

  it('1. Response Meta 200 dengan events_received: 0 menghasilkan deliveryConfirmed: false dan success: false (default strict)', async () => {
    vi.spyOn(capiBreaker, 'execute').mockResolvedValueOnce({
      status: 200,
      data: {
        events_received: 0,
        fbtrace_id: 'test_fbtrace_zero_events',
      },
    } as any);

    const result = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'c_zero', phone: '08123456789' },
      tenantId: 'default-tenant',
      value: 150000,
      reservationId: 'res-zero-1',
    });

    expect(result.status).toBe(200);
    expect(result.eventsReceived).toBe(0);
    expect(result.deliveryConfirmed).toBe(false);
    expect(result.success).toBe(false);
    expect(result.fbtrace_id).toBe('test_fbtrace_zero_events');
  });

  it('2. Response Meta 200 dengan events_received: 1 menghasilkan deliveryConfirmed: true', async () => {
    vi.spyOn(capiBreaker, 'execute').mockResolvedValueOnce({
      status: 200,
      data: {
        events_received: 1,
        fbtrace_id: 'test_fbtrace_success_1',
      },
    } as any);

    const result = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'c_ok', phone: '08123456789' },
      tenantId: 'default-tenant',
      value: 150000,
      reservationId: 'res-ok-1',
    });

    expect(result.status).toBe(200);
    expect(result.eventsReceived).toBe(1);
    expect(result.deliveryConfirmed).toBe(true);
    expect(result.sentEventId).toBe('pur_default-tenant_res-ok-1');
  });

  it('3. testEventCode disematkan pada ROOT payload Graph API, bukan di dalam custom_data', async () => {
    let capturedPayload: any = null;
    vi.spyOn(capiBreaker, 'execute').mockImplementationOnce(async (_url: string, payload: any) => {
      capturedPayload = payload;
      return {
        status: 200,
        data: {
          events_received: 1,
          fbtrace_id: 'test_fbtrace_code',
        },
      } as any;
    });

    await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'c_test_code', phone: '08123456789' },
      tenantId: 'default-tenant',
      value: 100000,
      reservationId: 'res-code-1',
      testEventCode: 'TEST12345',
    });

    expect(capturedPayload).toBeDefined();
    expect(capturedPayload.test_event_code).toBe('TEST12345');
    const firstEvent = capturedPayload.data[0];
    expect(firstEvent.custom_data.test_event_code).toBeUndefined();
  });

  it('4. sendCapiEvent membaca customData.testEventCode (camelCase) ke ROOT payload dan menghapusnya dari custom_data', async () => {
    let capturedPayload: any = null;
    vi.spyOn(capiBreaker, 'execute').mockImplementationOnce(async (_url: string, payload: any) => {
      capturedPayload = payload;
      return { status: 200, data: { events_received: 1, fbtrace_id: 'trace_camel' } } as any;
    });

    await capiService.sendCapiEvent({
      eventName: 'Lead',
      customer: { id: 'c_camel', phone: '08123456789' },
      tenantId: 'default-tenant',
      customData: { testEventCode: 'TEST_CAMEL_99' },
    });

    expect(capturedPayload.test_event_code).toBe('TEST_CAMEL_99');
    expect(capturedPayload.data[0].custom_data.testEventCode).toBeUndefined();
    expect(capturedPayload.data[0].custom_data.test_event_code).toBeUndefined();
  });

  it('5. testCapiConnection menyematkan test_event_code di ROOT payload, bukan di dalam data[0]', async () => {
    let capturedPayload: any = null;
    const postSpy = vi.spyOn(axios, 'post').mockImplementationOnce(async (_url: string, payload: any) => {
      capturedPayload = payload;
      return { status: 200, data: { events_received: 1, fbtrace_id: 'trace_conn' } } as any;
    });

    const result = await capiService.testCapiConnection({
      eventName: 'Contact',
      testEventCode: 'TEST_CONN_77',
      tenantId: 'default-tenant',
    });

    expect(result.success).toBe(true);
    expect(capturedPayload.test_event_code).toBe('TEST_CONN_77');
    expect(capturedPayload.data[0].test_event_code).toBeUndefined();
    postSpy.mockRestore();
  });

  it('6. Route approve MQL Lead menolak (502) dan TIDAK mencatat audit MQL_LEAD_EVENT_SENT saat Meta 200 dengan events_received: 0', async () => {
    process.env.ADMIN_API_KEY = 'test_admin_key_lead_strict';
    const app = buildApp();
    try {
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValueOnce({
        id: 'cust-lead-zero',
        tenant_id: 'default-tenant',
        phone: '6285794219991',
        name: 'Bunda Sari',
        mql_triggered_at: new Date(),
        mql_bubble_count: 5,
        adClick: null,
      } as any);
      const breakerSpy = vi.spyOn(capiBreaker, 'execute').mockResolvedValueOnce({
        status: 200,
        data: { events_received: 0, fbtrace_id: 'trace_lead_zero' },
      } as any);
      const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/reservation/lead_cust-lead-zero/approve-purchase',
        headers: {
          'x-api-key': 'test_admin_key_lead_strict',
          'x-tenant-id': 'default-tenant',
        },
      });

      expect(breakerSpy).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(502);
      expect(res.body).toContain('events_received=0');
      expect(auditSpy).not.toHaveBeenCalled();
    } finally {
      await app.close().catch(() => {});
    }
  });

  it('7. A-006: Route manual POST /api/admin/customers/:id/send-event membalas 502 (success: false) saat Meta 200 dengan events_received: 0', async () => {
    process.env.ADMIN_API_KEY = 'test_admin_key_manual_strict';
    const app = buildApp();
    try {
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValueOnce({
        id: 'cust-manual-zero',
        tenant_id: 'default-tenant',
        phone: '6285794219992',
        name: 'Bunda Manual',
        adClick: null,
      } as any);
      const breakerSpy = vi.spyOn(capiBreaker, 'execute').mockResolvedValueOnce({
        status: 200,
        data: { events_received: 0, fbtrace_id: 'trace_manual_zero' },
      } as any);
      vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/customers/cust-manual-zero/send-event',
        headers: {
          'x-api-key': 'test_admin_key_manual_strict',
          'x-tenant-id': 'default-tenant',
        },
        payload: { eventName: 'Lead' },
      });

      expect(breakerSpy).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(502);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
    } finally {
      await app.close().catch(() => {});
    }
  });
});
