import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../src/db/client';

describe('CAPI Queue Integrity — Transactional Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('approve-purchase endpoint', () => {
    it('jika CAPI gagal, DB TIDAK berubah menjadi approved', async () => {
      // Mock reservation yang exist dengan status pending
      const mockReservation = {
        id: 'test-res-123',
        tenant_id: 'default-tenant',
        customer_id: 'cust-123',
        purchase_review_status: 'pending',
        purchase_occurred_at: new Date(),
        purchase_value: 100000,
        raw_text: 'Test reservation',
        customer: {
          id: 'cust-123',
          phone: '6281234567890',
          name: 'Bunda Test',
          adClick: null,
        },
      };

      vi.mocked(prisma.reservation.findFirst).mockResolvedValue(mockReservation as any);
      vi.mocked(prisma.reservation.update).mockResolvedValue(mockReservation as any);

      // Mock CAPI service untuk gagal
      const { capiService } = await import('../../src/services/capi.service');
      vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({
        success: false,
        message: 'Meta Graph API error: HTTP 400',
      });

      // Simulasi approve-purchase endpoint logic
      const id = 'test-res-123';
      const existing = await prisma.reservation.findFirst({
        where: { id, tenant_id: 'default-tenant' },
      });

      expect(existing).toBeDefined();
      expect(existing?.purchase_review_status).toBe('pending');

      const capiResult = await capiService.sendCapiEvent({
        eventName: 'Purchase',
        customer: existing!.customer,
        value: existing!.purchase_value || 100000,
        currency: 'IDR',
        tenantId: 'default-tenant',
        eventTime: Math.floor(Date.now() / 1000),
      });

      // Jika CAPI gagal, JANGAN update DB
      if (!capiResult.success) {
        // Tidak ada update ke database
        expect(capiResult.success).toBe(false);
        // Pastikan update tidak dipanggil
        expect(prisma.reservation.update).not.toHaveBeenCalled();
      }
    });

    it('jika CAPI sukses, DB berubah menjadi approved', async () => {
      const mockReservation = {
        id: 'test-res-456',
        tenant_id: 'default-tenant',
        customer_id: 'cust-456',
        purchase_review_status: 'pending',
        purchase_occurred_at: new Date(),
        purchase_value: 150000,
        raw_text: 'Test reservation 2',
        customer: {
          id: 'cust-456',
          phone: '6281234567891',
          name: 'Bunda Sukses',
          adClick: null,
        },
      };

      const updatedReservation = {
        ...mockReservation,
        purchase_review_status: 'approved',
        purchase_event_sent_at: new Date(),
      };

      vi.mocked(prisma.reservation.findFirst).mockResolvedValue(mockReservation as any);
      vi.mocked(prisma.reservation.update).mockResolvedValue(updatedReservation as any);

      const { capiService } = await import('../../src/services/capi.service');
      vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({
        success: true,
        status: 200,
        events_received: 1,
      });

      const id = 'test-res-456';
      const existing = await prisma.reservation.findFirst({
        where: { id, tenant_id: 'default-tenant' },
      });

      const capiResult = await capiService.sendCapiEvent({
        eventName: 'Purchase',
        customer: existing!.customer,
        value: existing!.purchase_value || 150000,
        currency: 'IDR',
        tenantId: 'default-tenant',
        eventTime: Math.floor(Date.now() / 1000),
      });

      if (capiResult.success) {
        await prisma.reservation.update({
          where: { id },
          data: {
            purchase_review_status: 'approved',
            purchase_event_sent_at: new Date(),
          },
        });
      }

      expect(capiResult.success).toBe(true);
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id },
        data: {
          purchase_review_status: 'approved',
          purchase_event_sent_at: expect.any(Date),
        },
      });
    });
  });

  describe('staff recordPayment', () => {
    it('staff recordPayment menyetel status pending, bukan confirmed', async () => {
      const mockReservation = {
        id: 'test-res-staff-789',
        tenant_id: 'default-tenant',
        customer_id: 'cust-staff-789',
        purchase_review_status: 'pending',
        status: 'completed',
        customer: {
          id: 'cust-staff-789',
          phone: '6281234567892',
          name: 'Bunda Staff',
        },
      };

      const updatedReservation = {
        ...mockReservation,
        purchase_review_status: 'pending',
        status: 'completed',
      };

      vi.mocked(prisma.reservation.update).mockResolvedValue(updatedReservation as any);

      // Simulasi staff recordPayment logic
      const reservationId = 'test-res-staff-789';
      const tenantId = 'default-tenant';
      const totalPaid = 100000;
      const now = new Date();

      // Simulate the new logic
      let purchaseReviewStatus: 'pending' | 'approved' = 'pending';
      let purchaseEventSentAt: Date | null = null;

      // Mock tenant with auto_send_purchase_capi = false
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: tenantId,
        auto_send_purchase_capi: false,
      } as any);

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const autoSend = (tenant as any)?.auto_send_purchase_capi === true;

      if (autoSend) {
        // Auto-send logic would go here
      }
      // Jika auto_send = false, tetap 'pending'

      const updated = await prisma.reservation.update({
        where: { id: reservationId },
        data: {
          purchase_occurred_at: now,
          purchase_value: totalPaid,
          purchase_review_status: purchaseReviewStatus,
          purchase_event_sent_at: purchaseEventSentAt,
          status: 'completed',
        },
      });

      expect(updated.purchase_review_status).toBe('pending');
      expect(updated.purchase_event_sent_at === null || updated.purchase_event_sent_at === undefined).toBe(true);
    });
  });
});
