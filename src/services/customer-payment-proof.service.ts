import { resolveExpectedPayment } from '../domain/payment-expected';
import { prisma } from '../db/client';
import { StaffReservationService } from './staff-reservation.service';
import { sheetsSyncService } from './sheets/sheets-sync.service';
import { AuditService } from './audit.service';
import { resolveDeliveryFeeSnapshot } from './reservation-core.service';
import { detectReceipt, type ReceiptSignal } from './payment-receipt-vision.service';
import { customerService } from './customer.service';
import { conversationService } from './conversation.service';
import { resolveNextPurchaseReviewStatus } from './capi-review-status';
import { ACTIVE_RESERVATION_STATUSES } from '../domain/reservation-status';
import { resolvePaymentProofPolicy } from './payment-proof-config.service';
import { selectPaymentProofCandidate } from '../domain/select-payment-proof-candidate';
import { resolveReservationBilling } from './reservation-billing.service';

const auditService = new AuditService();

/**
 * Cache idempoten in-memory untuk mencegah dobel proses WA Message ID yang sama.
 */
const processedWaMessageIds = new Set<string>();

/**
 * Klaim pemrosesan waMessageId secara idempoten.
 * Mengembalikan true bila pesan berhasil diklaim (belum pernah diproses),
 * atau false bila pesan sedang/sudah diproses.
 */
function claimProcessedWaMessage(waMessageId: string): boolean {
  if (!waMessageId) return true;
  if (processedWaMessageIds.has(waMessageId)) return false;
  processedWaMessageIds.add(waMessageId);
  if (processedWaMessageIds.size > 2000) {
    const it = processedWaMessageIds.values();
    for (let i = 0; i < 500; i++) {
      processedWaMessageIds.delete(it.next().value!);
    }
  }
  return true;
}

/**
 * Melepas klaim waMessageId bila pemrosesan gagal (mis. NO_ACTIVE_RESERVATION),
 * agar webhook retry atau pengiriman ulang dapat diproses kembali.
 */
function releaseProcessedWaMessage(waMessageId: string): void {
  if (!waMessageId) return;
  processedWaMessageIds.delete(waMessageId);
}

export function _clearProcessedCacheForTesting(): void {
  processedWaMessageIds.clear();
}

/**
 * Menentukan label metode pembayaran secara data-driven dari DB (StaffReservationService.getPaymentInfo).
 * DILARANG keras hardcoding mapping if bank === "BCA" -> "Transfer BCA".
 */
export async function resolvePaymentMethodLabel(
  tenantId: string,
  bankDestination: string | null
): Promise<{ label: string; isOfficialDestination: boolean; needsReview: boolean }> {
  try {
    const paymentInfo = await StaffReservationService.getPaymentInfo(tenantId);
    const dest = (bankDestination || '').trim();
    if (!dest) {
      return { label: 'Transfer', isOfficialDestination: false, needsReview: true };
    }

    const destUpper = dest.toUpperCase();

    // 1. Cek apakah QRIS
    if (destUpper.includes('QRIS')) {
      const hasQris = Boolean(paymentInfo.qrisImageUrl);
      return {
        label: 'QRIS',
        isOfficialDestination: hasQris || (paymentInfo.bankAccounts && paymentInfo.bankAccounts.length > 0),
        needsReview: !hasQris,
      };
    }

    // 2. Cocokkan dengan bankAccounts resmi di database klinik
    const accounts = Array.isArray(paymentInfo.bankAccounts) ? paymentInfo.bankAccounts : [];
    const matched = accounts.find((acc) => {
      const bUpper = (acc.bank || '').trim().toUpperCase();
      return bUpper.length > 0 && (destUpper === bUpper || destUpper.includes(bUpper) || bUpper.includes(destUpper));
    });

    if (matched) {
      return {
        label: `Transfer ${matched.bank.trim()}`,
        isOfficialDestination: true,
        needsReview: false,
      };
    }

    // 3. Rekening asing / tidak terdaftar di DB klinik
    return {
      label: 'Transfer',
      isOfficialDestination: false,
      needsReview: true,
    };
  } catch (err: any) {
    console.warn(`[PAYMENT PROOF] Gagal resolvePaymentMethodLabel: ${err?.message || err}`);
    return { label: 'Transfer', isOfficialDestination: false, needsReview: true };
  }
}

/**
 * Menempelkan bukti pembayaran ke reservasi aktif pelanggan secara aman,
 * disertai guard duplikat, verifikasi rekening resmi, dan downside guard nominal.
 */
export async function attachCustomerPaymentProof(params: {
  tenantId: string;
  customerId: string;
  conversationId: string;
  mediaUrl: string;
  signal: ReceiptSignal;
  waMessageId: string;
  buffer?: Buffer;
  mimeType?: string;
}): Promise<{ attached: boolean; reason: string; reservationId?: string; isMismatch?: boolean; receiptAmount?: number | null }> {
  const { tenantId, customerId, conversationId, mediaUrl, signal, waMessageId, buffer, mimeType } = params;

  try {
    // 1. Guard Idempotensi pesan
    if (waMessageId && !claimProcessedWaMessage(waMessageId)) {
      return { attached: false, reason: 'ALREADY_PROCESSED' };
    }

    // 2. Guard Duplikat Referensi / Bukti (Anti-Fraud & Dedup) dalam 30 hari terakhir
    const ref = signal.referenceNumber?.trim();
    if (ref || (mediaUrl && mediaUrl.trim())) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const orConditions: any[] = [];
      if (ref) {
        orConditions.push({ receipt_reference: ref });
        orConditions.push({ raw_text: { contains: `[RECEIPT_REF:${ref}]` } });
      }
      if (mediaUrl && mediaUrl.trim()) {
        orConditions.push({ proof_url: mediaUrl.trim() });
      }

      const existingDuplicate = await prisma.reservation.findFirst({
        where: {
          tenant_id: tenantId,
          created_at: { gte: thirtyDaysAgo },
          OR: orConditions,
        },
        select: { id: true, receipt_reference: true, proof_url: true },
      });

      if (existingDuplicate) {
        if (waMessageId) releaseProcessedWaMessage(waMessageId);
        const isUrlDup = Boolean(mediaUrl && existingDuplicate.proof_url === mediaUrl.trim());
        const reason = isUrlDup ? 'DUPLICATE_PROOF_URL' : 'DUPLICATE_REFERENCE';
        console.warn(
          `[PAYMENT PROOF FRAUD GUARD] Bukti transfer duplikat terdeteksi (${reason}, existing reservation: ${existingDuplicate.id}).`
        );
        return { attached: false, reason, reservationId: existingDuplicate.id };
      }
    }

    // 3. Cari reservasi kandidat: status aktif / completed, belum lunas, belum ada bukti
    const now = new Date();
    const policy = await resolvePaymentProofPolicy(tenantId);
    const minBookingDate = new Date(now.getTime() - policy.windowBeforeDays * 24 * 60 * 60 * 1000);
    const maxBookingDate = new Date(now.getTime() + policy.windowAfterDays * 24 * 60 * 60 * 1000);

    const matchStatuses = Array.from(
      new Set([
        ...ACTIVE_RESERVATION_STATUSES,
        ...ACTIVE_RESERVATION_STATUSES.map((s) => s.toUpperCase()),
        'completed',
        'COMPLETED',
      ])
    );

    let rawCandidates: any[] = [];
    try {
      const res = await prisma.reservation.findMany({
        where: {
          customer_id: customerId,
          tenant_id: tenantId,
          status: { in: matchStatuses },
          purchase_occurred_at: null,
          proof_url: null,
          OR: [
            {
              booking_date: {
                gte: minBookingDate,
                lte: maxBookingDate,
              },
            },
            { booking_date: null },
          ],
        },
        orderBy: [{ booking_date: 'asc' }, { created_at: 'desc' }],
        include: { customer: true, items: { select: { price: true } } },
      });
      if (Array.isArray(res)) {
        rawCandidates = res;
      }
    } catch (err: any) {
      // Fail-closed: kegagalan query TIDAK boleh diperlakukan sebagai "tidak ada
      // kandidat" (dulu memicu fallback tanpa filter status/tanggal).
      if (waMessageId) releaseProcessedWaMessage(waMessageId);
      console.error(`[PAYMENT PROOF] Gagal query kandidat: ${err?.message || err}`);
      return { attached: false, reason: 'INTERNAL_ERROR' };
    }

    const enrichedCandidates = await Promise.all(
      (rawCandidates || []).map(async (c) => {
        const billing = await resolveReservationBilling(c, tenantId).catch(() => null);
        const expectedTotal = billing
          ? billing.totalFee
          : (Number(c.purchase_value) || 0) + resolveDeliveryFeeSnapshot(c as any);
        return {
          ...c,
          expectedTotal,
        };
      })
    );

    const selection = selectPaymentProofCandidate({
      candidates: enrichedCandidates,
      signalAmount: signal.amount ?? null,
      transferDate: signal.transferDate ? new Date(signal.transferDate) : null,
      now,
    });

    console.log(
      `[PAYMENT PROOF] kandidat=${enrichedCandidates.length} terpilih=${selection.candidate?.id || '-'} exact=${selection.isExactAmountMatch}`
    );

    const reservation = selection.candidate;

    if (!reservation) {
      if (waMessageId) releaseProcessedWaMessage(waMessageId);
      return { attached: false, reason: 'NO_ACTIVE_RESERVATION' };
    }

    if (reservation.purchase_occurred_at) {
      if (waMessageId) releaseProcessedWaMessage(waMessageId);
      return { attached: false, reason: 'ALREADY_PAID', reservationId: reservation.id };
    }

    // 4. Simpan ke storage bukti bayar permanen bila buffer tersedia (kebal retensi chat)
    let finalProofUrl = mediaUrl;
    if (buffer && buffer.length > 0) {
      try {
        const { mediaService } = await import('./media.service');
        const saved = await mediaService.savePaymentProof({
          tenantId,
          buffer,
          mimeType,
        });
        if (saved?.hdUrl) {
          finalProofUrl = saved.hdUrl;
        }
      } catch (saveErr: any) {
        console.warn(
          `[PAYMENT PROOF] Gagal menyimpan ke payment-proofs permanen, fallback ke mediaUrl: ${saveErr?.message || saveErr}`
        );
        finalProofUrl = mediaUrl;
      }
    }

    // 5. Resolve label pembayaran dari database
    const methodInfo = await resolvePaymentMethodLabel(tenantId, signal.bankDestination);

    // 6. Downside Protection Guard: proteksi purchase_value resmi dari timpaan nominal kecil
    const deliveryFee = resolveDeliveryFeeSnapshot(reservation as any);
    const existingPurchaseValue = Number((reservation as any).purchase_value) || 0;
    const payment = resolveExpectedPayment({
      purchaseValue: existingPurchaseValue,
      discountAmount: (reservation as any).discount_amount,
      deliveryFee,
      receiptAmount: signal.amount,
    });
    const totalExpected = payment.expected;
    const isMismatch = payment.isMismatch;
    const isUnderpaid = payment.isUnderpaid;

    let finalPurchaseValue = existingPurchaseValue;

    if (signal.amount != null && signal.amount > 0) {
      if (existingPurchaseValue > 0 && isUnderpaid) {
        console.warn(
          `[PAYMENT PROOF DOWNSIDE GUARD] Transfer Rp ${signal.amount} < total tagihan Rp ${totalExpected} (layanan: ${existingPurchaseValue} + ongkir: ${deliveryFee}) pada reservasi ${reservation.id}. Mempertahankan purchase_value resmi.`
        );
      } else if (existingPurchaseValue === 0) {
        finalPurchaseValue = Math.max(0, signal.amount - deliveryFee);
      }
    }

    // 7. Verifikasi tanggal transfer & tentukan flag review staf
    let purchaseOccurredAt = now;
    let isTransferDateSuspicious = false;

    if (signal.transferDate) {
      const parsedDate = new Date(signal.transferDate);
      if (!isNaN(parsedDate.getTime())) {
        const diffFuture = parsedDate.getTime() - now.getTime();
        if (diffFuture > 24 * 60 * 60 * 1000) {
          isTransferDateSuspicious = true;
          purchaseOccurredAt = now;
        } else {
          purchaseOccurredAt = parsedDate;
        }
      }
    }

    const shouldVerify =
      !methodInfo.isOfficialDestination ||
      isUnderpaid ||
      isMismatch ||
      isTransferDateSuspicious ||
      Boolean(reservation.needs_staff_verification);

    // 8. Pertahankan 'approved' bila CAPI sudah pernah terkirim (kontrak kanonik).
    const updateData: any = {
      proof_url: finalProofUrl,
      payment_method: methodInfo.label,
      purchase_occurred_at: purchaseOccurredAt,
      purchase_review_status: resolveNextPurchaseReviewStatus(reservation as any),
      needs_staff_verification: shouldVerify,
      purchase_value: finalPurchaseValue,
    };

    if (signal.amount != null && signal.amount > 0) {
      updateData.receipt_amount = signal.amount;
    }

    const currentRaw = reservation.raw_text || '';
    const rawTags: string[] = [];

    if (signal.amount != null && signal.amount > 0) {
      const amountTag = `[RECEIPT_AMOUNT:${signal.amount}]`;
      if (!currentRaw.includes(amountTag)) {
        rawTags.push(amountTag);
      }
      if (isMismatch) {
        const mismatchTag = `[TRANSFER_MISMATCH:TRANSFER=${signal.amount};EXPECTED=${totalExpected};DIFF=${payment.difference}]`;
        if (!currentRaw.includes('[TRANSFER_MISMATCH:')) {
          rawTags.push(mismatchTag);
        }
      }
    }

    if (signal.referenceNumber) {
      updateData.receipt_reference = signal.referenceNumber.trim();
      const refTag = `[RECEIPT_REF:${signal.referenceNumber.trim()}]`;
      if (!currentRaw.includes(refTag)) {
        rawTags.push(refTag);
      }
    }

    if (rawTags.length > 0) {
      updateData.raw_text = currentRaw ? `${currentRaw}\n${rawTags.join('\n')}` : rawTags.join('\n');
    }

    await prisma.reservation.update({
      where: { id: reservation.id },
      data: updateData,
    });

    // 8. Sheets sync enqueue (best effort, akan di-skip oleh sheetsSyncService sampai completed)
    sheetsSyncService.enqueue(reservation.id, tenantId).catch((err: any) => {
      console.warn(`[PAYMENT PROOF] Sheets enqueue deferred/skipped: ${err?.message || err}`);
    });

    // 9. Audit log admin action
    try {
      await auditService.logAdminAction({
        apiKey: process.env.ADMIN_API_KEY || 'system-auto-proof',
        adminIdentity: 'SYSTEM_AUTO_PROOF',
        action: 'AUTO_PAYMENT_PROOF_ATTACHED',
        targetId: reservation.id,
        tenantId,
        payload: {
          paymentMethod: methodInfo.label,
          amount: signal.amount,
          receiptAmount: signal.amount,
          totalExpected,
          gross: payment.gross,
          discount: payment.discount,
          net: payment.net,
          paymentStatus: payment.status,
          isMismatch,
          reference: signal.referenceNumber,
          mediaUrl: finalProofUrl,
          isOfficialDestination: methodInfo.isOfficialDestination,
          needsVerification: shouldVerify,
        },
      });
    } catch (auditErr: any) {
      console.warn(`[PAYMENT PROOF] Audit log skipped: ${auditErr?.message || auditErr}`);
    }

    // 10. LiveChatHub SSE broadcast
    try {
      const { getLiveChatHub } = await import('./live-chat-hub.service');
      getLiveChatHub()
        .publish({
          type: 'conversation.updated',
          tenantId,
          payload: {
            conversationId,
            event: 'payment_proof_attached',
            reservationId: reservation.id,
            mediaUrl: finalProofUrl,
            paymentMethod: methodInfo.label,
            receiptAmount: signal.amount ?? null,
            totalExpected,
            discount: payment.discount,
            paymentStatus: payment.status,
            isMismatch,
          },
        })
        .catch(() => {});
    } catch {}

    return { attached: true, reason: 'PROOF_ATTACHED', reservationId: reservation.id, isMismatch, receiptAmount: signal.amount ?? null };
  } catch (err: any) {
    if (waMessageId) releaseProcessedWaMessage(waMessageId);
    console.error(`[PAYMENT PROOF ERROR] Gagal menempelkan bukti bayar: ${err?.message || err}`);
    return { attached: false, reason: 'INTERNAL_ERROR' };
  }
}

/**
 * Handler fire-and-forget dari webhook inbound WhatsApp.
 * Menjalankan Vision LLM dan menempelkan bukti transfer di background tanpa menahan webhook.
 */
export async function attachFromInbound(params: {
  tenantId: string;
  phone: string;
  contactName?: string | null;
  mediaUrl: string;
  buffer: Buffer;
  mimeType: string;
  waMessageId: string;
}): Promise<void> {
  const { tenantId, phone, contactName, mediaUrl, buffer, mimeType, waMessageId } = params;

  try {
    // 1. Jalankan deteksi Vision di background
    const signal = await detectReceipt({ tenantId, buffer, mimeType });

    if (!signal.isPaymentReceipt) {
      return;
    }

    // 2. Resolve customer dan conversation
    const customer = await customerService.getOrCreateCustomer(phone, contactName || undefined, tenantId);
    if (!customer) return;

    const conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);
    if (!conversation) return;

    // 3. Tempelkan bukti transfer ke reservasi
    const attachResult = await attachCustomerPaymentProof({
      tenantId,
      customerId: customer.id,
      conversationId: conversation.id,
      mediaUrl,
      signal,
      waMessageId,
      buffer,
      mimeType,
    });

    if (attachResult.attached) {
      console.log(
        `[PAYMENT PROOF] Bukti transfer berhasil ditempelkan ke reservasi ${attachResult.reservationId} (cust: ${phone}, method: ${signal.bankDestination || 'Transfer'}, nominal: ${signal.amount})`
      );
    } else {
      console.log(`[PAYMENT PROOF] Bukti transfer tidak ditempelkan: ${attachResult.reason} (cust: ${phone})`);
    }
  } catch (err: any) {
    console.warn(`[PAYMENT PROOF INBOUND] Background processing error: ${err?.message || err}`);
  }
}
