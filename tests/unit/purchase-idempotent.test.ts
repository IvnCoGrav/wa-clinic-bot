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
      expect(eventId1).toBe(`org_pur_${resId}_${eventTime}`);
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
      expect(sentPayload.data[0].event_id).toBe('ctwa_12345678901234567890_cust-ctwa-1');
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
  });
});
