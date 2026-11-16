import { prisma } from '../db/client';
import { auditService } from './audit.service';
import { resolveReservationBilling } from './reservation-billing.service';

/**
 * reservation-payment-verification.service.ts — Seam kanonis verifikasi bukti
 * pembayaran transfer/non-tunai oleh CS/Admin (dipindah dari route agar route
 * tetap tipis dan bebas akses Prisma langsung).
 *
 * Tanggung jawab: baca reservasi tenant-scoped, simpan bukti ke storage permanen,
 * hitung nominal tagihan kanonis, catat pembayaran, lalu audit. Status kunjungan
 * TIDAK diubah di sini: penyelesaian kunjungan tetap wewenang bidan lewat
 * `completeTask` (Gate 6.1 wajib bidan tetap terjaga).
 * Pemanggil (route) hanya memetakan hasil ke HTTP + fallback in-memory.
 */

export interface VerifyReservationPaymentInput {
  tenantId: string;
  reservationId: string;
  proofImageB64?: string;
  mimeType?: string;
  paymentMethod?: string;
  amount?: number;
  auditContext: {
    apiKey?: string;
    adminIdentity?: string;
    ipAddress?: string;
  };
}

export interface VerifiedPaymentData {
  reservationId: string;
  status: string;
  completed: boolean;
  paymentMethod: string | null;
  proofUrl: string | null;
  purchaseValue: number | null;
  purchaseOccurredAt: Date | null;
  alreadyPaid: boolean;
  message?: string;
}

export type VerifyReservationPaymentResult =
  | { kind: 'not_found' }
  | { kind: 'proof_required' }
  | { kind: 'price_missing' }
  | { kind: 'amount_mismatch'; expectedTotal: number; receivedAmount: number }
  | { kind: 'already_paid'; data: VerifiedPaymentData }
  | { kind: 'verified'; data: VerifiedPaymentData };

export async function verifyReservationPayment(
  input: VerifyReservationPaymentInput
): Promise<VerifyReservationPaymentResult> {
  const { tenantId, reservationId, proofImageB64, mimeType, amount, auditContext } = input;

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, tenant_id: tenantId },
    include: {
      customer: true,
      items: { select: { price: true } },
    },
  });

  if (!reservation) return { kind: 'not_found' };

  let proofUrl = reservation.proof_url ?? null;
  if (proofImageB64) {
    const { mediaService } = await import('./media.service');
    const rawB64 = proofImageB64.replace(/^data:image\/[^;]+;base64,/, '');
    const resized = await mediaService.resizeImageToMax(Buffer.from(rawB64, 'base64'), 800);
    const saved = await mediaService.savePaymentProof({
      tenantId,
      buffer: resized,
      mimeType: mimeType && mimeType !== 'application/octet-stream' ? mimeType : 'image/jpeg',
      fileName: `proof-${reservationId}.jpg`,
    });
    proofUrl = saved.hdUrl;
  }

  const paymentMethod = input.paymentMethod || reservation.payment_method || 'TRANSFER';

  // Validasi bukti transfer: anti-bypass, bukti wajib ada kecuali tunai.
  if (paymentMethod !== 'CASH' && !proofUrl) {
    return { kind: 'proof_required' };
  }

  // Idempotensi: bila sudah lunas sebelumnya, jangan tulis ulang.
  if (reservation.purchase_occurred_at) {
    return {
      kind: 'already_paid',
      data: {
        reservationId: reservation.id,
        status: reservation.status,
        completed: reservation.status === 'completed',
        paymentMethod: reservation.payment_method,
        proofUrl: reservation.proof_url,
        purchaseValue: reservation.purchase_value,
        purchaseOccurredAt: reservation.purchase_occurred_at,
        alreadyPaid: true,
        message: 'Pembayaran reservasi ini sudah diverifikasi sebelumnya.',
      },
    };
  }

  // Tagihan resmi dari seam kanonis: `expected = purchase_value (GROSS) - diskon
  // + ongkir`. Server adalah otoritas nominal — `amount` dari klien hanya
  // dipakai sebagai pembanding, bukan sumber angka.
  const billing = await resolveReservationBilling(reservation as any, tenantId);
  if (!(billing.totalFee > 0)) {
    return { kind: 'price_missing' };
  }
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    const received = Math.round(amount);
    if (received !== Math.round(billing.totalFee)) {
      return { kind: 'amount_mismatch', expectedTotal: billing.totalFee, receivedAmount: received };
    }
  }

  // Verifikasi PEMBAYARAN tidak menyelesaikan kunjungan. Status reservasi
  // dibiarkan apa adanya agar bidan tetap menutup kunjungan via `completeTask`
  // (Gate 6.1 wajib bidan tidak bisa dilewati dari dashboard).
  const now = new Date();
  const updated = await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      purchase_occurred_at: now,
      // Kontrak kanonis: purchase_value = GROSS (sebelum diskon).
      purchase_value: billing.treatmentFee,
      payment_method: paymentMethod,
      proof_url: proofUrl,
      needs_staff_verification: false,
    },
  });

  try {
    if (reservation.customer_id) {
      const { customerService } = await import('./customer.service');
      await customerService.recalculateCustomerLtv(reservation.customer_id, tenantId);
    }
  } catch (ltvErr: any) {
    console.warn('[ADMIN VERIFY PAYMENT] Recalculate customer LTV failed:', ltvErr.message);
  }

  await auditService.logAdminAction({
    apiKey: auditContext.apiKey as string,
    adminIdentity: auditContext.adminIdentity,
    action: 'ADMIN_VERIFY_PAYMENT',
    targetId: reservationId,
    tenantId,
    payload: {
      paymentMethod,
      expectedTotal: billing.totalFee,
      grossTreatmentValue: billing.treatmentFee,
      discount: billing.discount,
      deliveryFee: billing.deliveryFee,
      proofUrl,
      status: updated.status,
      completed: updated.status === 'completed',
      statusChanged: false,
    },
    ipAddress: auditContext.ipAddress,
  });

  return {
    kind: 'verified',
    data: {
      reservationId: updated.id,
      status: updated.status,
      completed: updated.status === 'completed',
      paymentMethod,
      proofUrl,
      purchaseValue: updated.purchase_value,
      purchaseOccurredAt: updated.purchase_occurred_at,
      alreadyPaid: false,
    },
  };
}
