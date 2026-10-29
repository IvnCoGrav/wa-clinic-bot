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

const auditService = new AuditService();

/**
 * Cache idempoten in-memory untuk mencegah dobel proses WA Message ID yang sama.
 */
const processedWaMessageIds = new Set<string>();

/**
 * Helper untuk membersihkan cache idempoten agar tidak terjadi memory leak.
 */
function recordProcessedWaMessage(waMessageId: string): boolean {
  if (!waMessageId) return false;
  if (processedWaMessageIds.has(waMessageId)) return true;
  processedWaMessageIds.add(waMessageId);
  if (processedWaMessageIds.size > 2000) {
    const it = processedWaMessageIds.values();
    for (let i = 0; i < 500; i++) {
      processedWaMessageIds.delete(it.next().value!);
    }
  }
  return false;
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
}): Promise<{ attached: boolean; reason: string; reservationId?: string; isMismatch?: boolean; receiptAmount?: number | null }> {
  const { tenantId, customerId, conversationId, mediaUrl, signal, waMessageId } = params;

  try {
    // 1. Guard Idempotensi pesan
    if (waMessageId && recordProcessedWaMessage(waMessageId)) {
      return { attached: false, reason: 'ALREADY_PROCESSED' };
    }

    // 2. Guard Duplikat Referensi (Anti-Fraud) dalam 30 hari terakhir
    if (signal.referenceNumber && signal.referenceNumber.trim()) {
      const ref = signal.referenceNumber.trim();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const existingDuplicate = await prisma.reservation.findFirst({
        where: {
          tenant_id: tenantId,
          created_at: { gte: thirtyDaysAgo },
          OR: [
            { receipt_reference: ref },
            { raw_text: { contains: `[RECEIPT_REF:${ref}]` } },
          ],
        },
        select: { id: true, receipt_reference: true },
      });

      if (existingDuplicate) {
        console.warn(
          `[PAYMENT PROOF FRAUD GUARD] Bukti transfer duplikat terdeteksi (ref: ${ref}, existing reservation: ${existingDuplicate.id}).`
        );
        return { attached: false, reason: 'DUPLICATE_REFERENCE', reservationId: existingDuplicate.id };
      }
    }

    // 3. Cari reservasi aktif: status IN confirmed/hold/pending/en_route + window H-7..H+1
    const now = new Date();
    const minBookingDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const maxBookingDate = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

    const activeStatuses = ['confirmed', 'hold', 'pending', 'en_route', 'CONFIRMED', 'HOLD', 'PENDING', 'EN_ROUTE'];

    let reservation = await prisma.reservation.findFirst({
      where: {
        customer_id: customerId,
        tenant_id: tenantId,
        status: { in: activeStatuses },
        booking_date: {
          gte: minBookingDate,
          lte: maxBookingDate,
        },
      },
      orderBy: { booking_date: 'desc' },
      include: { customer: true },
    });

    // Fallback jika booking_date kosong (mis. reservasi pending tanpa slot fix)
    if (!reservation) {
      reservation = await prisma.reservation.findFirst({
        where: {
          customer_id: customerId,
          tenant_id: tenantId,
          status: { in: activeStatuses },
          booking_date: null,
        },
        orderBy: { created_at: 'desc' },
        include: { customer: true },
      });
    }

    if (!reservation) {
      return { attached: false, reason: 'NO_ACTIVE_RESERVATION' };
    }

    // 4. Resolve label pembayaran dari database
    const methodInfo = await resolvePaymentMethodLabel(tenantId, signal.bankDestination);

    // 5. Downside Protection Guard: proteksi purchase_value resmi dari timpaan nominal kecil
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

    // Flag staff review jika rekening asing, nominal di bawah tagihan, atau nominal tidak sesuai
    const shouldVerify = !methodInfo.isOfficialDestination || isUnderpaid || isMismatch || reservation.needs_staff_verification;

    // 6. Pertahankan 'approved' bila CAPI sudah pernah terkirim (kontrak kanonik).
    const updateData: any = {
      proof_url: mediaUrl,
      payment_method: methodInfo.label,
      purchase_occurred_at: signal.transferDate ? new Date(signal.transferDate) : now,
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

    // 7. Sheets sync enqueue (best effort, akan di-skip oleh sheetsSyncService sampai completed)
    sheetsSyncService.enqueue(reservation.id, tenantId).catch((err: any) => {
      console.warn(`[PAYMENT PROOF] Sheets enqueue deferred/skipped: ${err?.message || err}`);
    });

    // 8. Audit log admin action
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
          mediaUrl,
          isOfficialDestination: methodInfo.isOfficialDestination,
          needsVerification: shouldVerify,
        },
      });
    } catch (auditErr: any) {
      console.warn(`[PAYMENT PROOF] Audit log skipped: ${auditErr?.message || auditErr}`);
    }

    // 9. LiveChatHub SSE broadcast
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
            mediaUrl,
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
