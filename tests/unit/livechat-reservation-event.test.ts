import { describe, it, expect } from 'vitest';
import { buildReservationUpdatedPayload } from '../../src/domain/livechat-reservation-event';

describe('buildReservationUpdatedPayload — SSE contract builder', () => {
  const convUuid = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
  const custId = 'cust-12345';

  it('meneruskan conversationId UUID apa adanya (bukan JID)', () => {
    const payload = buildReservationUpdatedPayload({
      conversationId: convUuid,
      customerId: custId,
      reservation: null,
    });
    expect(payload.conversationId).toBe(convUuid);
    expect(payload.conversationId).not.toContain('@c.us');
    expect(payload.customerId).toBe(custId);
    expect(payload.activeConfirmedReservation).toBeUndefined();
  });

  it('menyematkan customer_id dari reservation bila ada', () => {
    const reservation = {
      id: 'res-1',
      customer_id: 'cust-special',
      booking_date: '2026-11-18T09:00:00.000Z',
      status: 'confirmed',
      treatment_category: 'BABY',
      treatment_detail: 'Pijat Bayi',
      duration_minutes: 45,
    };
    const payload = buildReservationUpdatedPayload({
      conversationId: convUuid,
      customerId: custId,
      reservation,
      isNew: true,
    });
    expect(payload.activeConfirmedReservation).toBeDefined();
    expect(payload.activeConfirmedReservation?.customer_id).toBe('cust-special');
    expect(payload.activeConfirmedReservation?.id).toBe('res-1');
    expect(payload.activeConfirmedReservation?.booking_date).toBe('2026-11-18T09:00:00.000Z');
    expect(payload.activeConfirmedReservation?.duration_minutes).toBe(45);
    expect(payload.isNew).toBe(true);
    expect(payload.isUpdate).toBe(false);
  });

  it('fallback customer_id ke customerId bila reservation.customer_id kosong', () => {
    const reservation = {
      id: 'res-2',
      booking_date: new Date('2026-11-19T02:00:00.000Z'),
      status: 'en_route',
    };
    const payload = buildReservationUpdatedPayload({
      conversationId: convUuid,
      customerId: custId,
      reservation,
      isUpdate: true,
    });
    expect(payload.activeConfirmedReservation?.customer_id).toBe(custId);
    expect(payload.activeConfirmedReservation?.booking_date).toBe('2026-11-19T02:00:00.000Z');
    expect(payload.activeConfirmedReservation?.status).toBe('en_route');
    expect(payload.isUpdate).toBe(true);
    expect(payload.isNew).toBe(false);
  });

  it('menangani booking_date null/undefined', () => {
    const reservation = {
      id: 'res-3',
      booking_date: null,
      status: 'hold',
    };
    const payload = buildReservationUpdatedPayload({
      conversationId: convUuid,
      customerId: custId,
      reservation,
    });
    expect(payload.activeConfirmedReservation?.booking_date).toBeNull();
  });
});
