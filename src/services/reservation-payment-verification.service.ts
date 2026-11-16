import { prisma } from '../db/client';
import { auditService } from './audit.service';

/**
 * reservation-payment-verification.service.ts — Seam kanonis verifikasi bukti
 * pembayaran transfer/non-tunai oleh CS/Admin (dipindah dari route agar route
 * tetap tipis dan bebas akses Prisma langsung).
 *
 * Tanggung jawab: baca reservasi tenant-scoped, simpan bukti, hitung nominal
 * tagihan, transisikan status ke completed bila layak, lalu catat audit.
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
    const saved = await mediaService.saveOutboundMedia({
      tenantId,
      imageB64: resized.toString('base64'),
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

  const deliveryFee = typeof (reservation as any).delivery_fee === 'number' ? (reservation as any).delivery_fee : 0;
  const items = Array.isArray((reservation as any).items) ? (reservation as any).items : [];
  const itemsTotal = items.reduce((sum: number, it: any) => sum + (Number(it?.price) || 0), 0);
  const discount = Number((reservation as any).discount_amount) || 0;
  let expectedTreatment: number | null = null;
  if (itemsTotal > 0) expectedTreatment = Math.max(0, itemsTotal - discount);
  else if (typeof (reservation as any).purchase_value === 'number') {
    expectedTreatment = Math.max(0, (reservation as any).purchase_value - discount);
  }
  const expectedTotal = expectedTreatment != null ? expectedTreatment + deliveryFee : null;
  const finalAmount = amount ?? expectedTotal ?? (reservation as any).purchase_value ?? 0;
  const pureTreatmentValue = Math.max(0, finalAmount - deliveryFee);
  const now = new Date();

  const { canTransition, isPrematureCompletion } = await import('../domain/reservation-status');
  const { reservationStatusService } = await import('./reservation-status.service');

  const updateData = {
    purchase_occurred_at: now,
    purchase_value: pureTreatmentValue,
    payment_method: paymentMethod,
    proof_url: proofUrl,
    needs_staff_verification: false,
  };

  let updated: any;
  const canComplete =
    canTransition(reservation.status, 'completed') && !isPrematureCompletion(reservation.booking_date);

  if (canComplete) {
    const applied = await reservationStatusService.applyTransition(reservation, {
      to: 'completed',
      allowUnassignedStaff: true,
      extraData: updateData,
    });
    updated = applied.ok ? applied.reservation : await prisma.reservation.update({ where: { id: reservationId }, data: updateData });
  } else {
    updated = await prisma.reservation.update({ where: { id: reservationId }, data: updateData });
  }

  try {
    if (reservation.customer_id) {
      const { customerService } = await import('./customer.service');
      await customerService.recalculateCustomerLtv(reservation.customer_id, tenantId);
    }
  } catch (ltvErr: any) {
    console.warn('[ADMIN VERIFY PAYMENT] Recalculate customer LTV failed:', ltvErr.message);
  }

  if (updated.status === 'completed' && reservation.booking_date) {
    try {
      const { sheetsSyncService } = await import('./sheets/sheets-sync.service');
      await sheetsSyncService.enqueue(reservation.id, tenantId).catch((err: any) =>
        console.warn('[ADMIN VERIFY PAYMENT] sheetsSync enqueue failed:', err?.message)
      );
    } catch (sheetsErr: any) {
      console.warn('[ADMIN VERIFY PAYMENT] sheetsSync enqueue failed:', sheetsErr.message);
    }
  }

  await auditService.logAdminAction({
    apiKey: auditContext.apiKey as string,
    adminIdentity: auditContext.adminIdentity,
    action: 'ADMIN_VERIFY_PAYMENT',
    targetId: reservationId,
    payload: {
      paymentMethod,
      amount: finalAmount,
      pureTreatmentValue,
      proofUrl,
      status: updated.status,
      completed: updated.status === 'completed',
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
