import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { capiService } from '../../src/services/capi.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { buildApp } from '../../src/app';
import { memoryReservations } from '../../src/routes/admin/stores';
import { prisma } from '../../src/db/client';

vi.mock('axios');

describe('Fase 1.2 & 2: Purchase Event Idempotency & Moderation Guards', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    memoryReservations.clear();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    process.env.FB_PIXEL_ID = 'test_pixel_123';
    process.env.FB_CAPI_ACCESS_TOKEN = 'test_token_123';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    memoryReservations.clear();
  });

  describe('1. Idempotent event_id Generation', () => {
    it('should generate stable identical event_id for Purchase events across retries', async () => {
      const customer = { id: 'cust-idem-1', phone: '08123456789' };
      const eventTime = 1787360000;
      const resId = 'res-idem-100';

      const sentPayloads: any[] = [];
      vi.mocked(axios.post).mockImplementation(async (_url: any, payload: any) => {
        sentPayloads.push(payload);
        return { status: 200, data: { events_received: 1 } };
      });

      await capiService.sendCapiEvent({
        eventName: 'Purchase',
        customer,
        reservationId: resId,
        eventTime,
        value: 150000,
        tenantId: DEFAULT_TENANT_ID,
      });

      await capiService.sendCapiEvent({
        eventName: 'Purchase',
        customer,
        reservationId: resId,
        eventTime,
        value: 150000,
        tenantId: DEFAULT_TENANT_ID,
      });

      expect(sentPayloads).toHaveLength(2);
      const eventId1 = sentPayloads[0].data[0].event_id;
      const eventId2 = sentPayloads[1].data[0].event_id;
      expect(eventId1).toBe(`pur_${DEFAULT_TENANT_ID}_${resId}`);
      expect(eventId1).toBe(eventId2);
    });

    it('should generate deterministic event_id for native CTWA clicks without tracking code', async () => {
      let sentPayload: any = null;
      vi.mocked(axios.post).mockImplementation(async (_url: any, payload: any) => {
        sentPayload = payload;
        return { status: 200, data: { events_received: 1 } };
      });

      await capiService.sendCapiEvent({
        eventName: 'Contact',
        customer: { id: 'cust-ctwa-1', phone: '08123456789' },
        adClick: { ctwa_clid: '12345678901234567890EXTRA' },
        tenantId: DEFAULT_TENANT_ID,
      });

      expect(sentPayload).not.toBeNull();
      expect(sentPayload.data[0].event_id).toBe('ctwa_12345678901234567890_cust-ctwa-1_contact');
    });
  });

  describe('2. Moderation approve-purchase Endpoint Guards', () => {
    it('should reject duplicate send with 400 when purchase_event_sent_at exists and force is false', async () => {
      const resId = 'res-already-sent-1';
      vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: 'cust-1',
        purchase_review_status: 'approved',
        purchase_event_sent_at: new Date('2026-10-01T10:00:00Z'),
        purchase_value: 150000,
        customer: { id: 'cust-1', phone: '08123456789' },
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/reservation/${resId}/approve-purchase`,
        headers: { 'x-api-key': 'test_admin_key_999', 'x-tenant-id': DEFAULT_TENANT_ID },
        payload: { force: false },
      });

      expect(response.statusCode).toBe(400);
      const json = JSON.parse(response.body);
      expect(json.success).toBe(false);
      expect(json.error).toContain('sudah pernah terkirim ke Meta CAPI');
    });

    it('should reject force resend with 400 when reason is missing or less than 5 characters', async () => {
      const resId = 'res-force-no-reason';
      vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: 'cust-1',
        purchase_review_status: 'approved',
        purchase_event_sent_at: new Date('2026-10-01T10:00:00Z'),
        purchase_value: 150000,
        customer: { id: 'cust-1', phone: '08123456789' },
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/reservation/${resId}/approve-purchase`,
        headers: { 'x-api-key': 'test_admin_key_999', 'x-tenant-id': DEFAULT_TENANT_ID },
        payload: { force: true, reason: 'abc' },
      });

      expect(response.statusCode).toBe(400);
      const json = JSON.parse(response.body);
      expect(json.success).toBe(false);
      expect(json.error).toContain('alasan minimal 5 karakter');
    });

    it('should reject event older than 7 days with 400 when allowAged is not true', async () => {
      const resId = 'res-aged-8days';
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: 'cust-1',
        purchase_review_status: 'pending',
        purchase_occurred_at: tenDaysAgo,
        purchase_value: 150000,
        customer: { id: 'cust-1', phone: '08123456789' },
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/reservation/${resId}/approve-purchase`,
        headers: { 'x-api-key': 'test_admin_key_999', 'x-tenant-id': DEFAULT_TENANT_ID },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const json = JSON.parse(response.body);
      expect(json.success).toBe(false);
      expect(json.error).toContain('>7 hari');
    });

    it('should reject with 400 if value is 0 or cannot be resolved from reservation data', async () => {
      const resId = 'res-no-value-detected';
      vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: 'cust-1',
        purchase_review_status: 'pending',
        purchase_value: 0,
        treatment_detail: 'Konsultasi tanya-tanya',
        raw_text: 'mau tanya info ya',
        customer: { id: 'cust-1', phone: '08123456789' },
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/reservation/${resId}/approve-purchase`,
        headers: { 'x-api-key': 'test_admin_key_999', 'x-tenant-id': DEFAULT_TENANT_ID },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const json = JSON.parse(response.body);
      expect(json.success).toBe(false);
      expect(json.error).toContain('Nilai transaksi tidak terdeteksi');
    });

    // D6 (2026-11-19): HTTP 200 + events_received=0 untuk event_id yang SUDAH
    // pernah terkonfirmasi adalah deduplikasi Meta, bukan kegagalan. Resend
    // tidak boleh membalas 502 dan tidak boleh menimpa snapshot nilai lama.
    it('should treat events_received=0 with already-delivered event_id as dedup (200), not 502', async () => {
      const resId = 'res-dedup-force';
      const storedEventId = `pur_${DEFAULT_TENANT_ID}_${resId}`;
      vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: 'cust-1',
        purchase_review_status: 'approved',
        purchase_occurred_at: new Date(Date.now() - 3600_000),
        purchase_event_sent_at: new Date('2026-10-01T10:00:00Z'),
        purchase_event_id: storedEventId,
        purchase_event_value: 150000,
        purchase_value: 150000,
        treatment_detail: 'Pijat Bayi',
        customer: { id: 'cust-1', phone: '08123456789', adClick: null },
      } as any);
      vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
        id: resId,
        purchase_value: 150000,
        purchase_event_value: 150000,
        purchase_event_id: storedEventId,
      } as any);

      const sentPayloads: any[] = [];
      vi.mocked(axios.post).mockImplementation(async (_url: any, payload: any) => {
        sentPayloads.push(payload);
        return { status: 200, data: { events_received: 0, fbtrace_id: 'trace-dedup' } };
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/reservation/${resId}/approve-purchase`,
        headers: { 'x-api-key': 'test_admin_key_999', 'x-tenant-id': DEFAULT_TENANT_ID },
        payload: { force: true, reason: 'kirim ulang manual untuk uji dedup' },
      });

      expect(response.statusCode).toBe(200);
      const json = JSON.parse(response.body);
      expect(json.success).toBe(true);
      expect(json.alreadyDelivered).toBe(true);
      expect(json.note).toContain('terdeduplikasi');
      expect(sentPayloads[0].data[0].event_id).toBe(storedEventId);

      const updateArg = vi.mocked(prisma.reservation.update).mock.calls[0][0] as any;
      // Snapshot nilai yang sudah diterima Meta tidak boleh ditimpa.
      expect(updateArg.data.purchase_event_value).toBe(150000);
      // Jangan menstempel ulang purchase_event_sent_at pada dedup.
      expect(updateArg.data.purchase_event_sent_at).toBeUndefined();
    });

    it('should still return 502 when Meta fails hard (non-200) even if the stored event_id matches', async () => {
      const resId = 'res-dedup-hard-fail';
      const storedEventId = `pur_${DEFAULT_TENANT_ID}_${resId}`;
      vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: 'cust-1',
        purchase_review_status: 'approved',
        purchase_occurred_at: new Date(Date.now() - 3600_000),
        purchase_event_sent_at: new Date('2026-10-01T10:00:00Z'),
        purchase_event_id: storedEventId,
        purchase_event_value: 150000,
        purchase_value: 150000,
        treatment_detail: 'Pijat Bayi',
        customer: { id: 'cust-1', phone: '08123456789', adClick: null },
      } as any);

      vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValueOnce({
        success: false,
        status: 500,
        message: 'Status code 500',
        sentEventId: storedEventId,
        deliveryConfirmed: false,
        eventsReceived: 0,
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/reservation/${resId}/approve-purchase`,
        headers: { 'x-api-key': 'test_admin_key_999', 'x-tenant-id': DEFAULT_TENANT_ID },
        payload: { force: true, reason: 'kirim ulang manual setelah error' },
      });

      expect(response.statusCode).toBe(502);
      const json = JSON.parse(response.body);
      expect(json.success).toBe(false);
      expect(prisma.reservation.update).not.toHaveBeenCalled();
    });
  });
});
