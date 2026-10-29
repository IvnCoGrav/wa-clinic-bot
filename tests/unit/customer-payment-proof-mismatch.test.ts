import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  attachCustomerPaymentProof,
  _clearProcessedCacheForTesting,
} from '../../src/services/customer-payment-proof.service';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { sheetsSyncService } from '../../src/services/sheets/sheets-sync.service';
import { type ReceiptSignal } from '../../src/services/payment-receipt-vision.service';

describe('Payment Receipt Mismatch Detection & Red Badge Data Layer (Unit Tests)', () => {
  const tenantId = 'default-tenant';
  const customerId = 'cust-mismatch-1';
  const conversationId = 'conv-mismatch-1';
  const mediaUrl = '/media/inbound/default-tenant/proof_mismatch.jpg';

  const mockOfficialPaymentInfo = {
    qrisImageUrl: 'https://example.com/qris.jpg',
    bankAccounts: [
      { bank: 'BCA', accountNumber: '1234567890', accountName: 'Klinik Utama' },
    ],
  };

  const baseActiveReservation = {
    id: 'res-mismatch-99',
    tenant_id: tenantId,
    customer_id: customerId,
    status: 'confirmed',
    booking_date: new Date(),
    purchase_value: 230000, // Layanan
    discount_amount: 0,
    delivery_fee: 20000,    // Ongkir -> Total expected = 250000
    proof_url: null,
    payment_method: null,
    receipt_reference: null,
    receipt_amount: null,
    raw_text: 'Reservasi Pasien Bunda',
    purchase_review_status: 'pending',
    needs_staff_verification: false,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    _clearProcessedCacheForTesting();
    vi.spyOn(StaffReservationService, 'getPaymentInfo').mockResolvedValue(mockOfficialPaymentInfo as any);
    vi.spyOn(sheetsSyncService, 'enqueue').mockResolvedValue('outbox-mismatch' as any);
  });

  describe('Kesesuaian Nilai (Match vs Mismatch)', () => {
    it('1. MATCH: Struk Rp 250.000 pas sesuai total tagihan (230rb + 20rb)', async () => {
      const matchSignal: ReceiptSignal = {
        isPaymentReceipt: true,
        bankDestination: 'BCA',
        amount: 250000,
        transferDate: '2026-10-24',
        referenceNumber: 'REF-MATCH-01',
        confidence: 0.96,
      };

      vi.spyOn(prisma.reservation, 'findFirst')
        .mockResolvedValueOnce(null) // no duplicate ref
        .mockResolvedValueOnce(baseActiveReservation as any);

      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({
        ...baseActiveReservation,
      } as any);

      vi.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: matchSignal,
        waMessageId: 'msg-match-1',
      });

      expect(result.attached).toBe(true);
      expect(result.isMismatch).toBe(false);
      expect(result.receiptAmount).toBe(250000);

      const updateData = updateSpy.mock.calls[0][0].data;
      expect(updateData.receipt_amount).toBe(250000);
      expect(updateData.raw_text).toContain('[RECEIPT_AMOUNT:250000]');
      expect(updateData.raw_text).not.toContain('[TRANSFER_MISMATCH:');
      expect(updateData.needs_staff_verification).toBe(false);
    });

    it('2. UNDERPAID (Kurang Bayar): Struk Rp 150.000 vs Tagihan Rp 250.000 -> isMismatch: true & Red Badge Flag', async () => {
      const underpaidSignal: ReceiptSignal = {
        isPaymentReceipt: true,
        bankDestination: 'BCA',
        amount: 150000, // Kurang Rp 100.000
        transferDate: '2026-10-24',
        referenceNumber: 'REF-UNDER-01',
        confidence: 0.95,
      };

      vi.spyOn(prisma.reservation, 'findFirst')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(baseActiveReservation as any);

      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({
        ...baseActiveReservation,
      } as any);

      vi.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: underpaidSignal,
        waMessageId: 'msg-under-1',
      });

      expect(result.attached).toBe(true);
      expect(result.isMismatch).toBe(true);
      expect(result.receiptAmount).toBe(150000);

      const updateData = updateSpy.mock.calls[0][0].data;
      expect(updateData.receipt_amount).toBe(150000);
      // Downside Guard: harga layanan asli tetap 230000, tidak ditimpa
      expect(updateData.purchase_value).toBe(230000);
      expect(updateData.needs_staff_verification).toBe(true);
      expect(updateData.raw_text).toContain('[RECEIPT_AMOUNT:150000]');
      expect(updateData.raw_text).toContain('[TRANSFER_MISMATCH:TRANSFER=150000;EXPECTED=250000;DIFF=-100000]');
    });

    it('3. OVERPAID (Lebih Bayar / Tips): Struk Rp 300.000 vs Tagihan Rp 250.000 -> isMismatch: true & Red Badge Flag', async () => {
      const overpaidSignal: ReceiptSignal = {
        isPaymentReceipt: true,
        bankDestination: 'BCA',
        amount: 300000, // Lebih Rp 50.000
        transferDate: '2026-10-24',
        referenceNumber: 'REF-OVER-01',
        confidence: 0.97,
      };

      vi.spyOn(prisma.reservation, 'findFirst')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(baseActiveReservation as any);

      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({
        ...baseActiveReservation,
      } as any);

      vi.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: overpaidSignal,
        waMessageId: 'msg-over-1',
      });

      expect(result.attached).toBe(true);
      expect(result.isMismatch).toBe(true);
      expect(result.receiptAmount).toBe(300000);

      const updateData = updateSpy.mock.calls[0][0].data;
      expect(updateData.receipt_amount).toBe(300000);
      expect(updateData.needs_staff_verification).toBe(true);
      expect(updateData.raw_text).toContain('[RECEIPT_AMOUNT:300000]');
      expect(updateData.raw_text).toContain('[TRANSFER_MISMATCH:TRANSFER=300000;EXPECTED=250000;DIFF=50000]');
    });

    it('4. UNREADABLE AMOUNT: Struk sah tapi nominal null/tidak terbaca', async () => {
      const unreadableSignal: ReceiptSignal = {
        isPaymentReceipt: true,
        bankDestination: 'BCA',
        amount: null,
        transferDate: '2026-10-24',
        referenceNumber: 'REF-NULL-01',
        confidence: 0.72,
      };

      vi.spyOn(prisma.reservation, 'findFirst')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(baseActiveReservation as any);

      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({
        ...baseActiveReservation,
      } as any);

      vi.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: unreadableSignal,
        waMessageId: 'msg-null-1',
      });

      expect(result.attached).toBe(true);
      expect(result.isMismatch).toBe(false);
      expect(result.receiptAmount).toBeNull();

      const updateData = updateSpy.mock.calls[0][0].data;
      expect(updateData.receipt_amount).toBeUndefined();
    });

    it('5. DISCOUNT APPLIED: Diskon 50rb (Layanan 300rb - 50rb + Ongkir 20rb = 270rb), Struk 270rb -> isMismatch: false', async () => {
      const matchSignal: ReceiptSignal = {
        isPaymentReceipt: true,
        bankDestination: 'BCA',
        amount: 270000,
        transferDate: '2026-10-24',
        referenceNumber: 'REF-DISCOUNT-01',
        confidence: 0.95,
      };

      const resWithDiscount = {
        ...baseActiveReservation,
        purchase_value: 300000,
        discount_amount: 50000,
        delivery_fee: 20000,
      };

      vi.spyOn(prisma.reservation, 'findFirst')
        .mockResolvedValueOnce(null) // no duplicate ref
        .mockResolvedValueOnce(resWithDiscount as any);

      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValue({
        ...resWithDiscount,
        proof_url: mediaUrl,
        receipt_amount: 270000,
      } as any);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: matchSignal,
        waMessageId: 'msg-discount-1',
      });

      expect(result.attached).toBe(true);
      expect(result.isMismatch).toBe(false);
      expect(result.receiptAmount).toBe(270000);

      const updateData = updateSpy.mock.calls[0][0].data;
      expect(updateData.needs_staff_verification).toBe(false);
      expect(updateData.purchase_value).toBe(300000);
      expect(updateData.raw_text).not.toContain('[TRANSFER_MISMATCH:');
    });

    it('6. PURCHASE VALUE ZERO: purchase_value = 0 -> finalPurchaseValue = max(0, amount - deliveryFee)', async () => {
      const signal: ReceiptSignal = {
        isPaymentReceipt: true,
        bankDestination: 'BCA',
        amount: 150000,
        transferDate: '2026-10-24',
        referenceNumber: 'REF-ZERO-01',
        confidence: 0.95,
      };

      const resZero = {
        ...baseActiveReservation,
        purchase_value: 0,
        discount_amount: null,
        delivery_fee: 25000,
      };

      vi.spyOn(prisma.reservation, 'findFirst')
        .mockResolvedValueOnce(null) // no duplicate ref
        .mockResolvedValueOnce(resZero as any);

      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValue({
        ...resZero,
        proof_url: mediaUrl,
        receipt_amount: 150000,
        purchase_value: 125000,
      } as any);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal,
        waMessageId: 'msg-zero-1',
      });

      expect(result.attached).toBe(true);
      const updateData = updateSpy.mock.calls[0][0].data;
      expect(updateData.purchase_value).toBe(125000); // 150.000 - 25.000
    });
  });
});
