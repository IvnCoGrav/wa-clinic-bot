import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reservationCoreService, resolveReservationPaymentEvaluation } from '../../src/services/reservation-core.service';
import { prisma } from '../../src/db/client';

describe('Reservation Discount Flow (Temuan I)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('saveReservation menyimpan discount_amount ke database saat diberikan', async () => {
    const createSpy = vi.spyOn(prisma.reservation, 'create').mockResolvedValueOnce({
      id: 'res-disc-1',
      tenant_id: 'default-tenant',
      customer_id: 'cust-1',
      treatment_category: 'BABY',
      treatment_detail: 'Pijat Bayi',
      purchase_value: 100000,
      discount_amount: 15000,
      delivery_fee: 10000,
      status: 'confirmed',
    } as any);

    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([]);

    const result = await reservationCoreService.saveReservation({
      tenantId: 'default-tenant',
      customerId: 'cust-1',
      source: 'ADMIN_PANEL',
      treatmentCategory: 'BABY',
      treatmentDetail: 'Pijat Bayi',
      purchaseValue: 100000,
      discountAmount: 15000,
      deliveryFee: 10000,
      bookingDate: new Date('2026-11-01T09:00:00Z'),
    });

    expect(result.reservation.id).toBe('res-disc-1');
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purchase_value: 100000,
          discount_amount: 15000,
          delivery_fee: 10000,
        }),
      })
    );
  });

  it('resolveReservationPaymentEvaluation menghitung tagihan net yang akurat dari gross - discount + delivery', () => {
    const mockRes = {
      purchase_value: 100000,
      discount_amount: 15000,
      delivery_fee: 10000,
      receipt_amount: 95000,
    };

    const evaluation = resolveReservationPaymentEvaluation(mockRes);
    expect(evaluation.gross).toBe(100000);
    expect(evaluation.discount).toBe(15000);
    expect(evaluation.net).toBe(85000);
    expect(evaluation.deliveryFee).toBe(10000);
    expect(evaluation.expected).toBe(95000);
    expect(evaluation.status).toBe('EXACT');
    expect(evaluation.isMismatch).toBe(false);
  });
});
