import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { mediaService } from '../../src/services/media.service';

/**
 * Kontrak pembayaran lapangan:
 * - Tagihan resmi = purchase_value (GROSS) - discount_amount + delivery_fee.
 * - `reservation_items` TIDAK menjadi otoritas (item bisa basi/tidak lengkap).
 * - Nominal tidak cocok TIDAK memblokir bukti; status menjadi AWAITING_VERIFICATION.
 * - Bukti disimpan di storage permanen sebelum evaluasi nominal.
 */
describe('recordPayment — tagihan kanonis & bukti tidak hilang', () => {
  const base = {
    reservationId: 'res-s07',
    staffId: 'staff-1',
    staffName: 'Bidan A',
    tenantId: 'default-tenant',
    paymentMethod: 'CASH' as const,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockReservation = (overrides: any = {}) => {
    (prisma.reservation.findUnique as any).mockResolvedValue({
      id: 'res-s07',
      tenant_id: 'default-tenant',
      assigned_staff_id: 'staff-1',
      customer_id: 'cust-1',
      status: 'completed',
      booking_date: new Date('2026-11-10T03:00:00Z'),
      treatment_category: 'MOMS',
      purchase_value: 100000,
      discount_amount: 0,
      delivery_fee: 20000,
      items: [{ price: 100000 }],
      customer: { id: 'cust-1', name: 'Bunda', conversations: [] },
      ...overrides,
    });
    (prisma.reservation.update as any).mockResolvedValue({
      id: 'res-s07',
      status: 'completed',
      purchase_value: 100000,
      purchase_occurred_at: new Date('2026-11-10T04:00:00Z'),
    });
  };

  it('nominal sesuai (purchase - diskon + ongkir) → LUNAS', async () => {
    mockReservation({ purchase_value: 100000, discount_amount: 10000, delivery_fee: 20000, items: [] });
    const res = await StaffReservationService.recordPayment({ ...base, amount: 110000 });
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('PAID');
    expect(res.data?.expectedTotal).toBe(110000);
    expect(prisma.reservation.update).toHaveBeenCalled();
  });

  it('nominal tidak cocok → bukti+metode disimpan, TIDAK ditandai lunas', async () => {
    mockReservation({ purchase_value: 100000, discount_amount: 10000, delivery_fee: 20000, items: [] });
    const res = await StaffReservationService.recordPayment({ ...base, amount: 120000 });
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('AWAITING_VERIFICATION');
    expect(res.data?.expectedTotal).toBe(110000);
    expect(res.data?.receivedAmount).toBe(120000);
    expect(res.data?.delta).toBe(10000);

    const updateArg = (prisma.reservation.update as any).mock.calls[0][0];
    expect(updateArg.data.payment_method).toBe('CASH');
    expect(updateArg.data.purchase_occurred_at).toBeUndefined();
    expect(updateArg.data.purchase_value).toBeUndefined();
  });

  it('items basi TIDAK boleh mengalahkan purchase_value', async () => {
    // Item hanya 1.000 (data lama), padahal purchase_value 100.000.
    mockReservation({ purchase_value: 100000, discount_amount: 0, delivery_fee: 0, items: [{ price: 1000 }] });
    const res = await StaffReservationService.recordPayment({ ...base, amount: 100000 });
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('PAID');
  });

  it('bukti tetap tersimpan saat nominal mismatch', async () => {
    mockReservation({ purchase_value: 100000, discount_amount: 0, delivery_fee: 0, items: [] });
    vi.spyOn(mediaService, 'resizeImageToMax').mockResolvedValue(Buffer.from('resized'));
    const saveProof = vi
      .spyOn(mediaService, 'savePaymentProof')
      .mockResolvedValue({
        hdPath: '/tmp/proof.jpg',
        hdUrl: '/media/payment-proofs/default-tenant/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
        sizeBytes: 7,
      });

    const res = await StaffReservationService.recordPayment({
      ...base,
      amount: 90000,
      proofImageB64: 'data:image/jpeg;base64,AAAA',
    });

    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('AWAITING_VERIFICATION');
    expect(saveProof).toHaveBeenCalledTimes(1);
    const updateArg = (prisma.reservation.update as any).mock.calls[0][0];
    expect(updateArg.data.proof_url).toMatch('/media/payment-proofs/');
    expect(updateArg.data.purchase_occurred_at).toBeUndefined();
  });
});
