import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  attachCustomerPaymentProof,
  _clearProcessedCacheForTesting,
} from '../../src/services/customer-payment-proof.service';
import { parseReceiptAmountFromRawText } from '../../src/services/live-chat.service';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { sheetsSyncService } from '../../src/services/sheets/sheets-sync.service';
import { type ReceiptSignal } from '../../src/services/payment-receipt-vision.service';
import { evaluatePaymentProof } from '../../packages/admin-dashboard/src/utils/paymentProof';

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
  });

  describe('Fallback Parsing Helper (parseReceiptAmountFromRawText)', () => {
    it('mengambil angka nominal dari format [RECEIPT_AMOUNT:xxx]', () => {
      const text = 'Catatan pasien\n[RECEIPT_REF:BCA123]\n[RECEIPT_AMOUNT:275000]';
      expect(parseReceiptAmountFromRawText(text)).toBe(275000);
    });

    it('mengembalikan null jika tidak ada tag RECEIPT_AMOUNT', () => {
      expect(parseReceiptAmountFromRawText('Hanya teks biasa')).toBeNull();
      expect(parseReceiptAmountFromRawText(null)).toBeNull();
      expect(parseReceiptAmountFromRawText(undefined)).toBeNull();
    });
  });

  describe('Frontend Evaluator Helper (evaluatePaymentProof)', () => {
    it('mengembalikan hasProof: false jika tidak ada bukti bayar', () => {
      const res = evaluatePaymentProof(null);
      expect(res.hasProof).toBe(false);
      expect(res.isMismatch).toBe(false);
    });

    it('mengembalikan match_green jika nominal transfer pas dengan tagihan', () => {
      const res = evaluatePaymentProof({
        proof_url: '/proof.jpg',
        purchase_value: 230000,
        delivery_fee: 20000,
        receipt_amount: 250000,
      });
      expect(res.hasProof).toBe(true);
      expect(res.isMismatch).toBe(false);
      expect(res.badgeVariant).toBe('match_green');
      expect(res.badgeLabel).toBe('Nominal Sesuai');
    });

    it('mengembalikan mismatch_red jika nominal struk KURANG (underpaid)', () => {
      const res = evaluatePaymentProof({
        proof_url: '/proof.jpg',
        purchase_value: 230000,
        delivery_fee: 20000,
        receipt_amount: 150000,
      });
      expect(res.hasProof).toBe(true);
      expect(res.isMismatch).toBe(true);
      expect(res.isUnderpaid).toBe(true);
      expect(res.badgeVariant).toBe('mismatch_red');
      expect(res.badgeLabel).toBe('Kurang Rp 100.000');
      expect(res.description).toContain('Tagihan: Rp 250.000');
    });

    it('mengembalikan mismatch_red jika nominal struk LEBIH (overpaid)', () => {
      const res = evaluatePaymentProof({
        proof_url: '/proof.jpg',
        purchase_value: 230000,
        delivery_fee: 20000,
        receipt_amount: 300000,
      });
      expect(res.hasProof).toBe(true);
      expect(res.isMismatch).toBe(true);
      expect(res.isOverpaid).toBe(true);
      expect(res.badgeVariant).toBe('mismatch_red');
      expect(res.badgeLabel).toBe('Lebih Rp 50.000');
    });

    it('fallback ke tag [RECEIPT_AMOUNT:xxx] dari raw_text jika receipt_amount null', () => {
      const res = evaluatePaymentProof({
        proof_url: '/proof.jpg',
        purchase_value: 230000,
        delivery_fee: 20000,
        receipt_amount: null,
        raw_text: 'Notes\n[RECEIPT_AMOUNT:200000]',
      });
      expect(res.hasProof).toBe(true);
      expect(res.isMismatch).toBe(true);
      expect(res.isUnderpaid).toBe(true);
      expect(res.receiptAmount).toBe(200000);
      expect(res.badgeVariant).toBe('mismatch_red');
      expect(res.badgeLabel).toBe('Kurang Rp 50.000');
    });
  });
});
