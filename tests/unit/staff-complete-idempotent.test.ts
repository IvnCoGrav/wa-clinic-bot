import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { reservationStatusService } from '../../src/services/reservation-status.service';

describe('Staff Complete & Payment Idempotency Tests (F4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('StaffReservationService.completeTask idempotency', () => {
    it('reservasi sudah completed -> return success true, alreadyCompleted true, no-op', async () => {
      const applySpy = vi.spyOn(reservationStatusService, 'applyTransition');

      (prisma.reservation.findUnique as any).mockResolvedValue({
        id: 'res-done-1',
        tenant_id: 'default-tenant',
        assigned_staff_id: 'staff-1',
        status: 'completed',
        booking_date: new Date('2026-11-10T03:00:00Z'),
        purchase_occurred_at: new Date('2026-11-10T04:00:00Z'),
        customer_id: 'cust-1',
      });

      const res = await StaffReservationService.completeTask({
        reservationId: 'res-done-1',
        staffId: 'staff-1',
        tenantId: 'default-tenant',
      });

      expect(res.success).toBe(true);
      expect(res.alreadyCompleted).toBe(true);
      expect(res.data.id).toBe('res-done-1');
      expect(applySpy).not.toHaveBeenCalled();
    });

    it('reservasi cancelled -> ditolak (tidak resurrect data mati)', async () => {
      (prisma.reservation.findUnique as any).mockResolvedValue({
        id: 'res-cancel-1',
        tenant_id: 'default-tenant',
        assigned_staff_id: 'staff-1',
        status: 'cancelled',
        booking_date: new Date('2026-11-10T03:00:00Z'),
        customer_id: 'cust-1',
      });

      const res = await StaffReservationService.completeTask({
        reservationId: 'res-cancel-1',
        staffId: 'staff-1',
        tenantId: 'default-tenant',
      });

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/tidak dapat diselesaikan/i);
    });
  });

  describe('StaffReservationService.recordPayment idempotency', () => {
    it('reservasi sudah lunas -> return success true, alreadyPaid true, no-op', async () => {
      const existingDate = new Date('2026-11-10T04:00:00Z');

      (prisma.reservation.findUnique as any).mockResolvedValue({
        id: 'res-paid-1',
        tenant_id: 'default-tenant',
        assigned_staff_id: 'staff-1',
        status: 'completed',
        booking_date: new Date('2026-11-10T03:00:00Z'),
        purchase_occurred_at: existingDate,
        purchase_value: 120000,
        payment_method: 'TRANSFER',
        proof_url: 'https://cdn.example.com/proof.jpg',
        delivery_fee: 20000,
        items: [{ price: 100000 }],
        customer: { id: 'cust-1', name: 'Bunda Ria', conversations: [] },
      });

      const updateSpy = vi.spyOn(prisma.reservation, 'update');

      const res = await StaffReservationService.recordPayment({
        reservationId: 'res-paid-1',
        staffId: 'staff-1',
        staffName: 'Bidan Ria',
        tenantId: 'default-tenant',
        paymentMethod: 'TRANSFER',
        amount: 120000,
      });

      expect(res.success).toBe(true);
      expect(res.data.alreadyPaid).toBe(true);
      expect(res.data.status).toBe('PAID');
      expect(res.data.reservationStatus).toBe('completed');
      expect(res.data.completed).toBe(true);
      expect(res.data.purchaseOccurredAt).toBe(existingDate);
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });
});
