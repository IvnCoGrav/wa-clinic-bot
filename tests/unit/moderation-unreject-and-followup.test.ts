import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { buildApp } from '../../src/app';
import { memoryReservations } from '../../src/routes/admin/stores';
import { prisma } from '../../src/db/client';

vi.mock('axios');

describe('Fase 4: Moderation Un-reject, Follow-up Auto Cancel, & Queue Filtering', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    memoryReservations.clear();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    process.env.FB_PIXEL_ID = 'test_pixel_123';
    process.env.FB_CAPI_ACCESS_TOKEN = 'test_token_123';
    vi.mocked(axios.post).mockResolvedValue({ status: 200, data: { events_received: 1 } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    memoryReservations.clear();
  });

  describe('1. POST /api/admin/reservation/:id/unreject-purchase', () => {
    it('should reject un-rejecting when reservation status is not ignored_outlier', async () => {
      const resId = 'res-not-outlier';
      vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        purchase_review_status: 'pending',
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/reservation/${resId}/unreject-purchase`,
        headers: { 'x-api-key': 'test_admin_key_999', 'x-tenant-id': DEFAULT_TENANT_ID },
      });

      expect(response.statusCode).toBe(400);
      const json = JSON.parse(response.body);
      expect(json.success).toBe(false);
      expect(json.error).toContain('Reservasi bukan berstatus outlier');
    });

    it('should restore reservation from ignored_outlier back to pending', async () => {
      const resId = 'res-is-outlier';
      vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        purchase_review_status: 'ignored_outlier',
      } as any);

      vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        purchase_review_status: 'pending',
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/reservation/${resId}/unreject-purchase`,
        headers: { 'x-api-key': 'test_admin_key_999', 'x-tenant-id': DEFAULT_TENANT_ID },
      });

      expect(response.statusCode).toBe(200);
      const json = JSON.parse(response.body);
      expect(json.success).toBe(true);
      expect(json.data.purchase_review_status).toBe('pending');
      expect(json.message).toContain('berhasil dikembalikan ke pending');
    });
  });

  describe('2. Auto-Cancel Follow-up on approve-purchase', () => {
    it('should automatically cancel pending NO_PURCHASE follow-ups when purchase is approved', async () => {
      const resId = 'res-closing-cust';
      const customerId = 'cust-closing-100';

      vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: customerId,
        purchase_review_status: 'pending',
        purchase_value: 120000,
        customer: { id: customerId, phone: '08123456789' },
      } as any);

      vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: customerId,
        purchase_review_status: 'approved',
        purchase_value: 120000,
      } as any);

      let followUpUpdateClause: any = null;
      vi.mocked(prisma.followUp.updateMany).mockImplementationOnce(async (args: any) => {
        followUpUpdateClause = args;
        return { count: 2 };
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/reservation/${resId}/approve-purchase`,
        headers: { 'x-api-key': 'test_admin_key_999', 'x-tenant-id': DEFAULT_TENANT_ID },
      });

      expect(response.statusCode).toBe(200);
      expect(followUpUpdateClause).not.toBeNull();
      expect(followUpUpdateClause.where.customer_id).toBe(customerId);
      expect(followUpUpdateClause.where.status).toEqual({ in: ['PENDING', 'QUEUED'] });
      expect(followUpUpdateClause.where.type).toBe('NO_PURCHASE');
      expect(followUpUpdateClause.data.status).toBe('CANCELLED');
    });
  });

  describe('3. GET /api/admin/capi-queue status filter', () => {
    it('should filter database query by purchase_review_status when status query param is provided', async () => {
      let findManyWhere: any = null;
      vi.mocked(prisma.reservation.findMany).mockImplementationOnce(async (args: any) => {
        findManyWhere = args.where;
        return [];
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/capi-queue?status=pending`,
        headers: { 'x-api-key': 'test_admin_key_999', 'x-tenant-id': DEFAULT_TENANT_ID },
      });

      expect(response.statusCode).toBe(200);
      expect(findManyWhere).not.toBeNull();
      expect(findManyWhere.purchase_review_status).toEqual({ in: ['pending'] });
    });
  });
});
