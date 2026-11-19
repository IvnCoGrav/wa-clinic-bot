import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  attachCustomerPaymentProof,
  resolvePaymentMethodLabel,
  attachFromInbound,
  _clearProcessedCacheForTesting,
} from '../../src/services/customer-payment-proof.service';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { sheetsSyncService } from '../../src/services/sheets/sheets-sync.service';
import { type ReceiptSignal } from '../../src/services/payment-receipt-vision.service';

describe('CustomerPaymentProofService (TDD Unit Tests)', () => {
  const tenantId = 'default-tenant';
  const customerId = 'cust-123';
  const conversationId = 'conv-456';
  const waMessageId = 'wam-789';
  const mediaUrl = '/media/inbound/default-tenant/proof_sample.jpg';

  const mockOfficialPaymentInfo = {
    qrisImageUrl: 'https://example.com/qris.jpg',
    bankAccounts: [
      { bank: 'BCA', accountNumber: '1234567890', accountName: 'Klinik Utama' },
      { bank: 'Mandiri', accountNumber: '0987654321', accountName: 'Klinik Utama' },
    ],
  };

  const mockActiveReservation = {
    id: 'res-999',
    tenant_id: tenantId,
    customer_id: customerId,
    status: 'confirmed',
    booking_date: new Date(),
    purchase_value: 230000,
    delivery_fee: 20000,
    proof_url: null,
    payment_method: null,
    receipt_reference: null,
    raw_text: 'Reservasi Baru',
    purchase_review_status: 'pending',
  };

  /**
   * Guard duplikat selalu memakai findFirst; kandidat reservasi memakai findMany.
   * Helper ini mencegah urutan mock yang rapuh (findFirst dipanggil 2x).
   */
  const mockNoDuplicate = () =>
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValueOnce(null);

  const mockCandidates = (rows: any[]) =>
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce(rows as any);

  beforeEach(() => {
    vi.restoreAllMocks();
    _clearProcessedCacheForTesting();
    vi.spyOn(StaffReservationService, 'getPaymentInfo').mockResolvedValue(mockOfficialPaymentInfo as any);
    vi.spyOn(sheetsSyncService, 'enqueue').mockResolvedValue('outbox-123' as any);
  });

  describe('resolvePaymentMethodLabel (DB-Driven, No Hardcoding)', () => {
    it('matches official BCA bank from DB and produces "Transfer BCA"', async () => {
      const result = await resolvePaymentMethodLabel(tenantId, 'BCA');
      expect(result.label).toBe('Transfer BCA');
      expect(result.isOfficialDestination).toBe(true);
      expect(result.needsReview).toBe(false);
    });

    it('matches official Mandiri bank from DB case-insensitively', async () => {
      const result = await resolvePaymentMethodLabel(tenantId, 'bank mandiri');
      expect(result.label).toBe('Transfer Mandiri');
      expect(result.isOfficialDestination).toBe(true);
      expect(result.needsReview).toBe(false);
    });

    it('matches QRIS if destination mentions QRIS', async () => {
      const result = await resolvePaymentMethodLabel(tenantId, 'QRIS');
      expect(result.label).toBe('QRIS');
      expect(result.isOfficialDestination).toBe(true);
      expect(result.needsReview).toBe(false);
    });

    it('returns generic "Transfer" with needsReview: true for unknown/foreign bank', async () => {
      const result = await resolvePaymentMethodLabel(tenantId, 'BANK DANAMON');
      expect(result.label).toBe('Transfer');
      expect(result.isOfficialDestination).toBe(false);
      expect(result.needsReview).toBe(true);
    });

    it('handles null bankDestination gracefully', async () => {
      const result = await resolvePaymentMethodLabel(tenantId, null);
      expect(result.label).toBe('Transfer');
      expect(result.isOfficialDestination).toBe(false);
      expect(result.needsReview).toBe(true);
    });
  });

  describe('attachCustomerPaymentProof', () => {
    const validSignal: ReceiptSignal = {
      isPaymentReceipt: true,
      bankDestination: 'BCA',
      amount: 250000,
      transferDate: '2026-10-14',
      referenceNumber: 'REF-BCA-001',
      confidence: 0.95,
    };

    it('attaches valid proof to active reservation as pending (CS moderation)', async () => {
      mockNoDuplicate();
      mockCandidates([mockActiveReservation]);

      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({
        ...mockActiveReservation,
        proof_url: mediaUrl,
        payment_method: 'Transfer BCA',
        receipt_reference: 'REF-BCA-001',
      } as any);

      const auditSpy = vi.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: validSignal,
        waMessageId,
      });

      expect(result.attached).toBe(true);
      expect(result.reservationId).toBe('res-999');
      expect(updateSpy).toHaveBeenCalled();
      const updateData = updateSpy.mock.calls[0][0].data;
      expect(updateData.proof_url).toBe(mediaUrl);
      expect(updateData.payment_method).toBe('Transfer BCA');
      expect(updateData.purchase_review_status).toBe('pending'); // NEVER approved directly!
      expect(updateData.receipt_reference).toBe('REF-BCA-001');

      expect(sheetsSyncService.enqueue).toHaveBeenCalledWith('res-999', tenantId);
    });

    it('blocks duplicate receipt reference within 30 days', async () => {
      vi.spyOn(prisma.reservation, 'findFirst')
        // 1. check duplicate returns existing reservation with same reference
        .mockResolvedValueOnce({
          id: 'res-old-888',
          tenant_id: tenantId,
          receipt_reference: 'REF-BCA-001',
          created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        } as any);

      const updateSpy = vi.spyOn(prisma.reservation, 'update');

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: validSignal,
        waMessageId,
      });

      expect(result.attached).toBe(false);
      expect(result.reason).toBe('DUPLICATE_REFERENCE');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('attaches with needs_staff_verification flag when bank is foreign / not in clinic accounts', async () => {
      const foreignSignal: ReceiptSignal = {
        ...validSignal,
        bankDestination: 'BANK JAGO',
      };

      mockNoDuplicate();
      mockCandidates([mockActiveReservation]);

      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({
        ...mockActiveReservation,
      } as any);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: foreignSignal,
        waMessageId,
      });

      expect(result.attached).toBe(true);
      const updateData = updateSpy.mock.calls[0][0].data;
      expect(updateData.payment_method).toBe('Transfer');
      expect(updateData.needs_staff_verification).toBe(true);
    });

    it('protects existing purchase_value when signal amount is smaller than expected total (Downside Guard)', async () => {
      const smallerAmountSignal: ReceiptSignal = {
        ...validSignal,
        amount: 50000, // expected total is 230000 + 20000 = 250000
      };

      mockNoDuplicate();
      mockCandidates([mockActiveReservation]);

      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({
        ...mockActiveReservation,
      } as any);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: smallerAmountSignal,
        waMessageId,
      });

      expect(result.attached).toBe(true);
      const updateData = updateSpy.mock.calls[0][0].data;
      // purchase_value remains existing 230000, not overwritten with small amount
      expect(updateData.purchase_value).toBe(230000);
      expect(updateData.needs_staff_verification).toBe(true);
    });

    it('returns attached: false when no active reservation exists for customer', async () => {
      mockNoDuplicate();
      mockCandidates([]);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: validSignal,
        waMessageId,
      });

      expect(result.attached).toBe(false);
      expect(result.reason).toBe('NO_ACTIVE_RESERVATION');
    });

    it('enforces tenant isolation — query kandidat selalu tenant-scoped', async () => {
      mockNoDuplicate();
      const findManySpy = vi
        .spyOn(prisma.reservation, 'findMany')
        .mockResolvedValueOnce([] as any);

      const result = await attachCustomerPaymentProof({
        tenantId: 'tenant-x',
        customerId,
        conversationId,
        mediaUrl,
        signal: validSignal,
        waMessageId,
      });

      expect(result.attached).toBe(false);
      expect(result.reason).toBe('NO_ACTIVE_RESERVATION');
      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenant_id: 'tenant-x', customer_id: customerId }),
        })
      );
    });

    it('handles exact amount match without auto-approving (must stay pending for CS moderation)', async () => {
      const exactSignal: ReceiptSignal = {
        ...validSignal,
        amount: 250000, // exact matches purchase_value (230000) + delivery_fee (20000)
      };

      mockNoDuplicate();
      mockCandidates([mockActiveReservation]);

      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({
        ...mockActiveReservation,
      } as any);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: exactSignal,
        waMessageId: 'wam-exact-match',
      });

      expect(result.attached).toBe(true);
      const updateData = updateSpy.mock.calls[0][0].data;
      expect(updateData.purchase_review_status).toBe('pending'); // MANDATORY: NEVER approved automatically!
    });

    it('preserves approved status when purchase_event_sent_at already set', async () => {
      mockNoDuplicate();
      mockCandidates([
        {
          ...mockActiveReservation,
          purchase_review_status: 'approved',
          purchase_event_sent_at: new Date('2026-10-15T11:23:50.758Z'),
        },
      ]);
      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({} as any);
      await attachCustomerPaymentProof({ tenantId, customerId, conversationId, mediaUrl, signal: validSignal, waMessageId: 'wam-approved' });
      expect(updateSpy.mock.calls[0][0].data.purchase_review_status).toBe('approved');
    });

    it('keeps pending for a fresh reservation without prior CAPI send', async () => {
      mockNoDuplicate();
      mockCandidates([mockActiveReservation]); // no sent_at
      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({} as any);
      await attachCustomerPaymentProof({ tenantId, customerId, conversationId, mediaUrl, signal: validSignal, waMessageId: 'wam-fresh' });
      expect(updateSpy.mock.calls[0][0].data.purchase_review_status).toBe('pending');
    });
  });

  describe('jalur produksi findMany (Fase 2 — anti-fallback)', () => {
    const day = 24 * 60 * 60 * 1000;
    const validSignal: ReceiptSignal = {
      isPaymentReceipt: true,
      bankDestination: 'BCA',
      amount: 250000,
      transferDate: '2026-10-14',
      referenceNumber: 'REF-BASE-01',
      confidence: 0.95,
    };

    it('mengirim filter status, jendela tanggal, belum lunas, dan belum berbukti', async () => {
      mockNoDuplicate();
      const findManySpy = vi
        .spyOn(prisma.reservation, 'findMany')
        .mockResolvedValueOnce([mockActiveReservation] as any);
      vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({} as any);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: { ...validSignal, referenceNumber: 'REF-FILTER-01' },
        waMessageId: 'wam-filter-01',
      });

      expect(result.attached).toBe(true);
      const where = findManySpy.mock.calls[0][0].where as any;
      expect(where.tenant_id).toBe(tenantId);
      expect(where.customer_id).toBe(customerId);
      expect(where.purchase_occurred_at).toBeNull();
      expect(where.proof_url).toBeNull();
      expect(where.status.in).toEqual(expect.arrayContaining(['confirmed']));
      // Jendela tanggal berada di dalam OR (kandidat bertanggal ATAU tanpa tanggal).
      const bookingWindow = where.OR?.[0]?.booking_date;
      expect(bookingWindow?.gte).toBeInstanceOf(Date);
      expect(bookingWindow?.lte).toBeInstanceOf(Date);
    });

    it('kandidat kosong TIDAK memicu fallback findFirst kedua', async () => {
      const findFirstSpy = vi
        .spyOn(prisma.reservation, 'findFirst')
        .mockResolvedValueOnce(null);
      mockCandidates([]);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: { ...validSignal, referenceNumber: 'REF-NO-CAND' },
        waMessageId: 'wam-no-cand',
      });

      expect(result.attached).toBe(false);
      expect(result.reason).toBe('NO_ACTIVE_RESERVATION');
      expect(findFirstSpy).toHaveBeenCalledTimes(1);
    });

    it('menempel ke reservasi completed pasca-visit (dalam jendela)', async () => {
      mockNoDuplicate();
      mockCandidates([
        {
          ...mockActiveReservation,
          status: 'completed',
          booking_date: new Date(Date.now() - 3 * 60 * 60 * 1000),
        },
      ]);
      vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({} as any);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: { ...validSignal, referenceNumber: 'REF-POST-VISIT' },
        waMessageId: 'wam-post-visit',
      });

      expect(result.attached).toBe(true);
      expect(result.reservationId).toBe('res-999');
    });

    it('menolak reservasi yang sudah lunas tanpa update', async () => {
      mockNoDuplicate();
      // Baris sudah lunas tetap dikirim mock untuk memastikan lapisan domain
      // (bukan hanya query DB) yang menolaknya.
      mockCandidates([
        { ...mockActiveReservation, purchase_occurred_at: new Date() },
      ]);
      const updateSpy = vi.spyOn(prisma.reservation, 'update');

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: { ...validSignal, referenceNumber: 'REF-ALREADY-PAID' },
        waMessageId: 'wam-already-paid',
      });

      expect(result.attached).toBe(false);
      expect(result.reason).toBe('NO_ACTIVE_RESERVATION');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('error database pada findMany menjadi INTERNAL_ERROR (fail-closed)', async () => {
      mockNoDuplicate();
      vi.spyOn(prisma.reservation, 'findMany').mockRejectedValueOnce(new Error('db down'));
      const updateSpy = vi.spyOn(prisma.reservation, 'update');

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: { ...validSignal, referenceNumber: 'REF-DB-DOWN' },
        waMessageId: 'wam-db-down',
      });

      expect(result.attached).toBe(false);
      expect(result.reason).toBe('INTERNAL_ERROR');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('nominal kembar memilih reservasi dengan tanggal terdekat dari transferDate', async () => {
      const transferDate = new Date();
      mockNoDuplicate();
      mockCandidates([
        {
          ...mockActiveReservation,
          id: 'res-far',
          booking_date: new Date(transferDate.getTime() + 5 * day),
        },
        {
          ...mockActiveReservation,
          id: 'res-near',
          booking_date: new Date(transferDate.getTime() + 1 * day),
        },
      ]);
      vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({} as any);

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: {
          ...validSignal,
          amount: 250000,
          transferDate: transferDate.toISOString().slice(0, 10),
          referenceNumber: 'REF-TIE',
        },
        waMessageId: 'wam-tie',
      });

      expect(result.attached).toBe(true);
      expect(result.reservationId).toBe('res-near');
    });
  });

  describe('attachFromInbound (Adversarial Inbound Webhook Execution)', () => {
    it('completely ignores non-receipt inbound media (baby photo, shareloc, etc.) without writing to DB', async () => {
      // Mock detectReceipt to return non-receipt
      const visionModule = await import('../../src/services/payment-receipt-vision.service');
      vi.spyOn(visionModule, 'detectReceipt').mockResolvedValueOnce({
        isPaymentReceipt: false,
        bankDestination: null,
        amount: null,
        transferDate: null,
        referenceNumber: null,
        confidence: 0.05,
      });

      const updateSpy = vi.spyOn(prisma.reservation, 'update');

      await attachFromInbound({
        tenantId,
        phone: '628123456789',
        contactName: 'Bunda Test',
        mediaUrl: '/media/inbound/baby.jpg',
        buffer: Buffer.from('baby-photo'),
        mimeType: 'image/jpeg',
        waMessageId: 'wam-baby-1',
      });

      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('attaches payment proof when incoming media is detected as a genuine receipt', async () => {
      const visionModule = await import('../../src/services/payment-receipt-vision.service');
      vi.spyOn(visionModule, 'detectReceipt').mockResolvedValueOnce({
        isPaymentReceipt: true,
        bankDestination: 'BCA',
        amount: 250000,
        transferDate: '2026-10-14',
        referenceNumber: 'REF-INBOUND-001',
        confidence: 0.95,
      });

      mockNoDuplicate();
      mockCandidates([
        {
          id: 'res-auto-inbound',
          tenant_id: tenantId,
          customer_id: 'cust-inbound',
          status: 'confirmed',
          booking_date: new Date(),
          purchase_value: 230000,
          delivery_fee: 20000,
          proof_url: null,
          payment_method: null,
          receipt_reference: null,
          raw_text: '',
          purchase_review_status: 'pending',
        },
      ]);

      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({} as any);

      await attachFromInbound({
        tenantId,
        phone: '628123456789',
        contactName: 'Bunda Test',
        mediaUrl: '/media/inbound/receipt.jpg',
        buffer: Buffer.from('receipt-bytes'),
        mimeType: 'image/jpeg',
        waMessageId: 'wam-receipt-1',
      });

      expect(updateSpy).toHaveBeenCalled();
      const updateData = updateSpy.mock.calls[0][0].data;
      expect(updateData.proof_url).toMatch(/^\/media\/payment-proofs\/default-tenant\/[a-f0-9]{32}\.jpe?g$/);
      expect(updateData.payment_method).toBe('Transfer BCA');
      expect(updateData.receipt_reference).toBe('REF-INBOUND-001');
    });

    it('Fase 1 T1.2: melepaskan klaim idempotensi bila gagal sehingga bisa di-retry', async () => {
      const retryMsgId = 'wam-retry-123';
      const validSignal: ReceiptSignal = {
        isPaymentReceipt: true,
        bankDestination: 'BCA',
        amount: 250000,
        transferDate: '2026-10-14',
        referenceNumber: 'REF-RETRY-001',
        confidence: 0.95,
      };

      // Percobaan 1: Belum ada reservasi aktif -> Gagal NO_ACTIVE_RESERVATION
      mockNoDuplicate();
      mockCandidates([]);

      const attempt1 = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: validSignal,
        waMessageId: retryMsgId,
      });

      expect(attempt1.attached).toBe(false);
      expect(attempt1.reason).toBe('NO_ACTIVE_RESERVATION');

      // Percobaan 2: Admin sudah buat reservasi -> Retry dengan message ID yang sama HARUS berhasil (tidak terblokir ALREADY_PROCESSED)
      mockNoDuplicate();
      mockCandidates([mockActiveReservation]); // reservasi sudah ada!

      vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({} as any);

      const attempt2 = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: validSignal,
        waMessageId: retryMsgId,
      });

      expect(attempt2.attached).toBe(true);
      expect(attempt2.reason).toBe('PROOF_ATTACHED');
    });

    it('Fase 1 T1.2: menolak bukti bila proof_url sudah tercatat di database reservasi lain (Dedup DB)', async () => {
      const dupUrlSignal: ReceiptSignal = {
        isPaymentReceipt: true,
        bankDestination: 'BCA',
        amount: 250000,
        transferDate: '2026-10-14',
        referenceNumber: null, // tanpa ref number
        confidence: 0.95,
      };

      // Mock duplicate check menemukan reservasi lain dengan proof_url yang sama
      vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValueOnce({
        id: 'res-existing-proof',
        tenant_id: tenantId,
        proof_url: mediaUrl,
        created_at: new Date(),
      } as any);

      const updateSpy = vi.spyOn(prisma.reservation, 'update');

      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl,
        signal: dupUrlSignal,
        waMessageId: 'wam-dup-url',
      });

      expect(result.attached).toBe(false);
      expect(result.reason).toBe('DUPLICATE_PROOF_URL');
      expect(result.reservationId).toBe('res-existing-proof');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('Fase 1 T1.1: menyimpan berkas ke storage permanen saat buffer diberikan', async () => {
      const bufferSignal: ReceiptSignal = {
        isPaymentReceipt: true,
        bankDestination: 'QRIS',
        amount: 155000,
        transferDate: '2026-11-16',
        referenceNumber: '0115001SZHJ7',
        confidence: 0.95,
      };

      mockNoDuplicate();
      mockCandidates([mockActiveReservation]);

      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValueOnce({} as any);

      const dummyBuffer = Buffer.from('dummy-image-bytes-nida');
      const result = await attachCustomerPaymentProof({
        tenantId,
        customerId,
        conversationId,
        mediaUrl: '/media/inbound/temp.jpg',
        signal: bufferSignal,
        waMessageId: 'wam-buffer-test',
        buffer: dummyBuffer,
        mimeType: 'image/jpeg',
      });

      expect(result.attached).toBe(true);
      expect(updateSpy).toHaveBeenCalled();
      const updateData = updateSpy.mock.calls[0][0].data;
      expect(updateData.proof_url).toMatch(/^\/media\/payment-proofs\/default-tenant\/[a-f0-9]{32}\.jpe?g$/);
      expect(updateData.payment_method).toBe('QRIS');
    });
  });
});
