import { describe, it, expect, vi, beforeEach } from 'vitest';
import { capiService, capiBreaker } from '../../src/services/capi.service';

describe('Task 2.8: CAPI Delivery Truth & Root testEventCode Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Response Meta 200 dengan events_received: 0 menghasilkan deliveryConfirmed: false', async () => {
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
});
