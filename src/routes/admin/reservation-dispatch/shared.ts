import { prisma } from '../../../db/client';
import { auditService } from '../../../services/audit.service';
import { isPrematureCompletion } from '../../../domain/reservation-status';
import { resolveReservationPaymentEvaluation } from '../../../services/reservation-core.service';
import {
  reservationStatusService,
  InvalidTransitionError,
  PrematureCompletionError,
} from '../../../services/reservation-status.service';

export function withPaymentEvaluation(r: any) {
  if (!r) return r;
  return { ...r, paymentEvaluation: resolveReservationPaymentEvaluation(r) };
}

/**
 * Hasil operasi tandai-selesai. `reason` hanya terisi saat gagal, dan dipetakan
 * ke kode HTTP oleh tiap pemanggil (satuan → 400/404; bulk → masuk `skipped`).
 */
export type CompleteOutcome =
  | { ok: true; reservation: any; existing: any }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_ELIGIBLE' | 'PREMATURE' | 'STAFF_REQUIRED' };

/**
 * Seam tunggal tandai-selesai reservasi (dipakai endpoint satuan DAN bulk).
 * Murni tahap mutasi status (findFirst + guard + update); efek samping
 * follow-up/Sheets/reset-sesi dilakukan terpisah lewat `runCompletionSideEffects`
 * agar pemanggil bisa memutuskan pencatatan audit sendiri.
 *
 * - `strict` true (bulk): hanya `confirmed`/`en_route` yang boleh lanjut
 *   (paritas `canTransition`). `strict` false (satuan): perilaku lama dipertahankan.
 * - Guard prematur (`isPrematureCompletion`) berlaku di kedua jalur.
 * - DB offline → melempar (pemanggil satuan menangkap untuk fallback memori;
 *   endpoint bulk memetakan ke 503 eksplisit).
 */
export async function completeReservationById(opts: {
  id: string;
  tenantId: string;
  forceComplete?: boolean;
  allowUnassignedStaff?: boolean;
  actor?: string;
  apiKey?: string;
  ipAddress?: string;
}): Promise<CompleteOutcome> {
  const existing = await reservationStatusService.getForTransition(opts.id, opts.tenantId);
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };

  if (isPrematureCompletion(existing.booking_date) && !opts.forceComplete) {
    return { ok: false, reason: 'PREMATURE' };
  }

  // Gate keras Fase 6.1: Wajibkan bidan saat completed
  if (!existing.assigned_staff_id) {
    if (!opts.allowUnassignedStaff) {
      return { ok: false, reason: 'STAFF_REQUIRED' };
    }
    // Phase 7 / H5: Audit trail eksplisit jika bypass allowUnassignedStaff digunakan
    auditService.logAdminAction({
      apiKey: opts.apiKey || 'internal',
      adminIdentity: opts.actor || 'admin',
      tenantId: opts.tenantId,
      action: 'RESERVATION_UNASSIGNED_COMPLETION_BYPASS',
      targetId: opts.id,
      payload: {
        reservationId: opts.id,
        tenantId: opts.tenantId,
        bookingDate: existing.booking_date,
        reason: 'Penyelesaian kunjungan tanpa bidan diizinkan lewat bypass allowUnassignedStaff',
      },
      ipAddress: opts.ipAddress,
    }).catch((err: any) => console.warn('[AUDIT] Failed to log unassigned bypass:', err.message));
  }

  try {
    const applied = await reservationStatusService.applyTransition(existing, {
      to: 'completed',
      force: opts.forceComplete,
      allowUnassignedStaff: opts.allowUnassignedStaff,
      include: {
        customer: { include: { children: true } },
        assigned_staff: { select: { id: true, name: true, phone: true } },
        children: true,
      },
    });
    if (!applied.ok) return applied;

    const reservation = applied.reservation;
    return { ok: true, reservation, existing };
  } catch (err: any) {
    if (err instanceof PrematureCompletionError) {
      return { ok: false, reason: 'PREMATURE' };
    }
    if (err instanceof InvalidTransitionError) {
      return { ok: false, reason: 'NOT_ELIGIBLE' };
    }
    throw err;
  }
}

/**
 * Efek samping terpusat setelah status `completed` tersimpan (MT-1.4):
 * jadwal follow-up/review + next-treatment + reset sesi V3 episodik. Best-effort:
 * kegagalan tidak pernah melempar ke pemanggil. `existing` = baris SEBELUM update.
 */
export async function runCompletionSideEffects(existing: any, tenantId: string): Promise<void> {
  try {
    const { reservationLifecycleService } = await import('../../../services/reservation-lifecycle.service');
    if (existing.booking_date) {
      await reservationLifecycleService.onReservationCompleted({
        customerId: existing.customer_id,
        reservationId: existing.id,
        bookingDate: existing.booking_date,
        treatmentCategory: existing.treatment_category,
        tenantId: existing.tenant_id || tenantId,
      });
    } else {
      console.warn(`[Admin API] runCompletionSideEffects: reservasi ${existing?.id} completed tanpa booking_date, sheets sync & follow-up dilewati`);
      // Tanpa booking_date: tetap reset sesi V3
      const activeConv = await prisma.conversation.findFirst({
        where: { customer_id: existing.customer_id, tenant_id: existing.tenant_id || tenantId },
        orderBy: { updated_at: 'desc' },
        select: { id: true },
      });
      if (activeConv?.id) {
        const { GoalTracker } = await import('../../../v3/state/goal-tracker');
        await GoalTracker.updateGoalSession(
          activeConv.id,
          {
            cartItems: [],
            selectedTreatment: undefined,
            booking: undefined,
            discussedTreatments: [],
            priceDiscussed: undefined,
            bookingCommitConfirmed: undefined,
            lastCommitment: undefined,
            ongkirStatus: undefined,
            totalPrice: undefined,
          } as any,
          existing.tenant_id || tenantId
        );
      }
    }
  } catch (fuErr: any) {
    console.warn('[Admin API] onReservationCompleted failed:', fuErr?.message);
  }
}

/** Batas aman jumlah id per satu request bulk-complete (tiap item memicu efek samping). */
export const BULK_COMPLETE_MAX_IDS = 50;
