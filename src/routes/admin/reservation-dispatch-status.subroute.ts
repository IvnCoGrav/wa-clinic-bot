import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { tenantOf } from './route-helpers';
import { auditService } from '../../services/audit.service';
import { googleCalendarService } from '../../services/google-calendar.service';
import { resolvePurchaseReviewOnConfirm } from '../../services/capi-review-status';
import { isPrematureCompletion } from '../../domain/reservation-status';
import { memoryReservations } from './stores';
import {
  reservationStatusService,
  InvalidTransitionError,
  PrematureCompletionError,
} from '../../services/reservation-status.service';

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
    const { reservationLifecycleService } = await import('../../services/reservation-lifecycle.service');
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
      const activeConv = await prisma.conversation.findFirst({
        where: { customer_id: existing.customer_id, tenant_id: existing.tenant_id || tenantId },
        orderBy: { updated_at: 'desc' },
        select: { id: true },
      });
      if (activeConv?.id) {
        const { GoalTracker } = await import('../../v3/state/goal-tracker');
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

export async function reservationDispatchStatusRoutes(fastify: FastifyInstance) {
  /**
   * PATCH /api/admin/reservation/:id/release-hold
   * Melepas slot hold -> transisi ke cancelled (audit utuh) + hook LTV/follow-up.
   */
  fastify.patch(
    '/api/admin/reservation/:id/release-hold',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const tenantId = tenantOf(request);
      const mem = memoryReservations.get(id);
      if (mem) {
        if (mem.tenant_id !== tenantId) {
          return reply.status(404).send({ success: false, error: 'Reservasi tidak ditemukan.' });
        }
        if (mem.status !== 'hold') {
          return reply.status(400).send({ success: false, error: 'Hanya reservasi berstatus hold yang dapat dilepas.' });
        }
        memoryReservations.delete(id);
        try {
          await auditService.logAdminAction({
            apiKey: (request as any).adminKeyUsed,
            adminIdentity: (request as any).adminIdentity,
            action: 'DELETE_HOLD_RESERVATION',
            targetId: id,
            payload: { previousStatus: 'hold', deleted: true },
            ipAddress: request.ip,
          });
        } catch {}
        return reply.status(200).send({ success: true, data: mem, deleted: true });
      }
      try {
        const reservation = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
        });
        if (!reservation) {
          return reply.status(404).send({ success: false, error: 'Reservasi tidak ditemukan.' });
        }
        if (reservation.status !== 'hold') {
          return reply.status(400).send({ success: false, error: 'Hanya reservasi berstatus hold yang dapat dilepas.' });
        }
        const applied = await reservationStatusService.applyTransition(reservation, { to: 'cancelled' });
        const cancelled = applied.ok ? applied.reservation : reservation;
        try {
          const { customerService } = await import('../../services/customer.service');
          await customerService.recalculateCustomerLtv(reservation.customer_id, tenantId);
        } catch {}
        try {
          const { followUpService } = await import('../../services/follow-up.service');
          await followUpService.onReservationCancelled(reservation.id, tenantId);
        } catch {}
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'RELEASE_HOLD_RESERVATION',
          targetId: id,
          payload: { previousStatus: 'hold', newStatus: 'cancelled' },
          ipAddress: request.ip,
        });
        return reply.status(200).send({ success: true, data: cancelled, deleted: false });
      } catch (err: any) {
        const mem2 = memoryReservations.get(id);
        if (mem2) {
          memoryReservations.delete(id);
          return reply.status(200).send({ success: true, data: mem2, deleted: true });
        }
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation/:id/confirm
   */
  fastify.patch(
    '/api/admin/reservation/:id/confirm',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: {
            customer: {
              include: {
                adClick: true,
              },
            },
          },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }
        const { canTransition, isHoldActive, isHoldActiveByCreated } = await import('../../domain/reservation-status');
        if (!canTransition(existing.status, 'confirmed')) {
          return reply.status(409).send({ success: false, code: 'ILLEGAL_TRANSITION', error: `Transisi ${existing.status} → confirmed ditolak.` });
        }
        if (existing.status === 'hold') {
          const holdOk = isHoldActive(existing.booking_date as any) && isHoldActiveByCreated((existing as any).created_at as any);
          if (!holdOk) {
            return reply.status(409).send({ success: false, code: 'HOLD_EXPIRED', error: 'Hold sudah kedaluwarsa, buat reservasi baru.' });
          }
        }

        let calendarEventId: string | null = null;
        try {
          const customerName = existing.customer?.name || 'Bunda';
          calendarEventId = await googleCalendarService.createEvent(existing, customerName);
        } catch (err) {
          console.error('[Admin API] Google Calendar Event creation failed:', err);
        }

        const applied = await reservationStatusService.applyTransition(existing, {
          to: 'confirmed',
          extraData: {
            purchase_review_status: resolvePurchaseReviewOnConfirm(existing as any),
            google_calendar_event_id: calendarEventId,
            needs_staff_verification: false,
          },
          include: {
            customer: { include: { children: true } },
            assigned_staff: { select: { id: true, name: true, phone: true } },
            children: true,
          },
        });
        const reservation = applied.ok ? applied.reservation : existing;

        if (existing.booking_date) {
          try {
            const { followUpService } = await import('../../services/follow-up.service');
            await followUpService.createReservationFollowUps({
              reservationId: id,
              customerId: existing.customer_id,
              bookingDate: existing.booking_date,
              treatmentCategory: existing.treatment_category,
              tenantId: existing.tenant_id || tenantId,
            });
          } catch (fuErr: any) {
            console.warn('[Admin API] Failed to schedule follow-ups on confirmation:', fuErr.message);
          }
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CONFIRM_RESERVATION',
          targetId: id,
          payload: { status: 'confirmed' },
          ipAddress: request.ip,
        });

        if (process.env.ENABLE_LIFECYCLE_LABELS === 'true') {
          try {
            const pendingLabel = await prisma.label.findFirst({
              where: { tenant_id: tenantId, name: 'Pending Payment' },
            });
            if (pendingLabel && existing.customer_id) {
              await prisma.customerLabel.deleteMany({
                where: { customer_id: existing.customer_id, label_id: pendingLabel.id },
              });
            }
          } catch (err: any) {
            console.warn('[LIFECYCLE LABEL] DB-only remove "Pending Payment" on confirm failed:', err.message);
          }
        }

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === tenantId) {
          mock.status = 'confirmed';
          mock.google_calendar_event_id = `mock_cal_event_${Date.now()}`;
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);

          if (process.env.ENABLE_LIFECYCLE_LABELS === 'true') {
            try {
              const pendingLabel = await prisma.label.findFirst({
                where: { tenant_id: tenantId, name: 'Pending Payment' },
              });
              const mockCustomerId = (mock as any).customer_id;
              if (pendingLabel && mockCustomerId) {
                await prisma.customerLabel.deleteMany({
                  where: { customer_id: mockCustomerId, label_id: pendingLabel.id },
                });
              }
            } catch (err: any) {
              console.warn(
                '[LIFECYCLE LABEL] DB-only remove "Pending Payment" on confirm (memory) failed:',
                err.message
              );
            }
          }

          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation/:id/complete
   * Menandai reservasi telah selesai treatment (status: 'completed')
   */
  fastify.patch(
    '/api/admin/reservation/:id/complete',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      try {
        const outcome = await completeReservationById({
          id,
          tenantId,
          forceComplete: (request.body as any)?.forceComplete,
          allowUnassignedStaff: (request.body as any)?.allowUnassignedStaff,
          actor: (request as any).adminIdentity,
          apiKey: (request as any).adminKeyUsed,
          ipAddress: request.ip,
        });

        if (!outcome.ok) {
          if (outcome.reason === 'PREMATURE') {
            return reply.status(400).send({
              success: false,
              code: 'PREMATURE_COMPLETION_BLOCKED',
              error: 'Reservasi masa depan tidak dapat ditandai sebagai completed sebelum tanggal kunjungan tiba. Gunakan forceComplete: true bila ada persetujuan darurat.',
            });
          }
          if (outcome.reason === 'STAFF_REQUIRED') {
            return reply.status(400).send({
              success: false,
              code: 'STAFF_ASSIGNMENT_REQUIRED',
              error: 'Reservasi tidak dapat diselesaikan tanpa penugasan bidan (assigned_staff_id). Tugaskan bidan terlebih dahulu atau sertakan allowUnassignedStaff: true dengan catatan audit.',
            });
          }
          if (outcome.reason === 'NOT_ELIGIBLE') {
            return reply.status(409).send({
              success: false,
              code: 'ILLEGAL_TRANSITION',
              error: 'Reservasi tidak dapat diselesaikan karena status saat ini tidak memenuhi syarat untuk transisi ke completed.',
            });
          }
          throw new Error('Reservation not found');
        }

        await runCompletionSideEffects(outcome.existing, tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'COMPLETE_RESERVATION',
          targetId: id,
          payload: { status: 'completed' },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: outcome.reservation });
      } catch (error) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === tenantId) {
          if (isPrematureCompletion(mock.booking_date) && !(request.body as any)?.forceComplete) {
            return reply.status(400).send({
              success: false,
              code: 'PREMATURE_COMPLETION_BLOCKED',
              error: 'Reservasi masa depan tidak dapat ditandai sebagai completed sebelum tanggal kunjungan tiba. Gunakan forceComplete: true bila ada persetujuan darurat.',
            });
          }
          mock.status = 'completed';
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );

  /**
   * POST /api/admin/reservations/bulk-complete
   */
  fastify.post(
    '/api/admin/reservations/bulk-complete',
    async (
      request: FastifyRequest<{ Body: { ids?: unknown; forceComplete?: boolean } }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const rawIds = (request.body as any)?.ids;

      if (!Array.isArray(rawIds)) {
        return reply.status(400).send({ success: false, code: 'INVALID_BODY', error: 'Field "ids" wajib berupa array of string.' });
      }

      const cleaned = rawIds
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      if (cleaned.length !== rawIds.length) {
        return reply.status(400).send({ success: false, code: 'INVALID_BODY', error: 'Setiap id wajib berupa string non-kosong.' });
      }

      const seen = new Set<string>();
      const ids: string[] = [];
      for (const id of cleaned) {
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }

      if (ids.length === 0) {
        return reply.status(400).send({ success: false, code: 'EMPTY_IDS', error: 'Minimal satu id diperlukan.' });
      }
      if (ids.length > BULK_COMPLETE_MAX_IDS) {
        return reply.status(400).send({
          success: false,
          code: 'TOO_MANY_IDS',
          error: `Maksimal ${BULK_COMPLETE_MAX_IDS} reservasi per sekali proses.`,
        });
      }

      try {
        await prisma.reservation.findMany({ where: { tenant_id: tenantId, id: { in: ids } }, select: { id: true } });
      } catch {
        return reply.status(503).send({
          success: false,
          code: 'DB_OFFLINE',
          error: 'Basis data sedang tidak tersedia. Operasi massal dibatalkan agar tidak berjalan setengah jalan. Coba lagi beberapa saat.',
        });
      }

      const completed: string[] = [];
      const skipped: Array<{ id: string; reason: string }> = [];

      for (const id of ids) {
        let outcome: CompleteOutcome;
        try {
          outcome = await completeReservationById({
            id,
            tenantId,
            forceComplete: false,
            allowUnassignedStaff: (request.body as any)?.allowUnassignedStaff,
            actor: (request as any).adminIdentity,
            apiKey: (request as any).adminKeyUsed,
            ipAddress: request.ip,
          });
        } catch (err: any) {
          skipped.push({ id, reason: 'DB_ERROR' });
          continue;
        }
        if (!outcome.ok) {
          skipped.push({ id, reason: outcome.reason });
          continue;
        }
        await runCompletionSideEffects(outcome.existing, tenantId);
        completed.push(id);
      }

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'BULK_COMPLETE_RESERVATIONS',
        payload: { completed, skipped, requested: ids.length },
        ipAddress: request.ip,
      });

      return reply.status(200).send({ success: true, completed, skipped });
    }
  );

  /**
   * PATCH /api/admin/reservation/:id/status
   */
  fastify.patch(
    '/api/admin/reservation/:id/status',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status: 'hold' | 'confirmed' | 'completed' | 'cancelled' };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      const { status } = request.body || {};

      if (!['hold', 'confirmed', 'completed', 'cancelled'].includes(status)) {
        return reply.status(400).send({ error: 'Status tidak valid. Pilihan: hold, confirmed, completed, cancelled.' });
      }

      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        const { canTransition: canT2, isHoldActive: isHA2, isHoldActiveByCreated: isHAC2 } = await import('../../domain/reservation-status');
        if (!canT2(existing.status, status)) {
          return reply.status(409).send({ success: false, code: 'ILLEGAL_TRANSITION', error: `Transisi ${existing.status} → ${status} ditolak.` });
        }
        if (existing.status === 'hold' && status === 'confirmed') {
          const holdOk2 = isHA2(existing.booking_date as any) && isHAC2((existing as any).created_at as any);
          if (!holdOk2) {
            return reply.status(409).send({ success: false, code: 'HOLD_EXPIRED', error: 'Hold sudah kedaluwarsa.' });
          }
        }
        if (status === 'completed' && isPrematureCompletion(existing.booking_date) && !(request.body as any)?.forceComplete) {
          return reply.status(400).send({
            success: false,
            code: 'PREMATURE_COMPLETION_BLOCKED',
            error: 'Reservasi masa depan tidak dapat ditandai sebagai completed sebelum tanggal kunjungan tiba. Gunakan forceComplete: true bila ada persetujuan darurat.',
          });
        }

        if (status === 'completed' && !existing.assigned_staff_id && !(request.body as any)?.allowUnassignedStaff) {
          return reply.status(400).send({
            success: false,
            code: 'STAFF_ASSIGNMENT_REQUIRED',
            error: 'Reservasi tidak dapat diselesaikan tanpa penugasan bidan (assigned_staff_id). Tugaskan bidan terlebih dahulu atau sertakan allowUnassignedStaff: true.',
          });
        }

        const isReactivatingToConfirmed = status === 'confirmed' && existing.status !== 'confirmed';
        const forceStatus = Boolean((request.body as any)?.force);
        if (isReactivatingToConfirmed && existing.assigned_staff_id && existing.booking_date && !forceStatus) {
          const { findOverlappingStaffReservations } = await import('../../services/reservation-core.service');
          const staffConflicts = await findOverlappingStaffReservations({
            tenantId,
            staffId: existing.assigned_staff_id,
            bookingDate: existing.booking_date,
            durationMinutes: existing.duration_minutes ?? 60,
            excludeId: existing.id,
          });
          if (staffConflicts.length > 0) {
            return reply.status(409).send({
              success: false,
              code: 'STAFF_COLLISION',
              error: 'Jadwal terapis bentrok dengan reservasi lain.',
              conflict: staffConflicts[0],
            });
          }
        }

        const updateStatusData: any = { status };
        if (status === 'confirmed' && existing.status !== 'confirmed') {
          updateStatusData.purchase_review_status = resolvePurchaseReviewOnConfirm(existing as any);
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: updateStatusData,
          include: {
            customer: { include: { children: true } },
            assigned_staff: { select: { id: true, name: true, phone: true } },
            children: true,
          },
        });

        try {
          const { followUpService } = await import('../../services/follow-up.service');
          if (status === 'confirmed' && existing.booking_date) {
            await followUpService.createReservationFollowUps({
              reservationId: id,
              customerId: existing.customer_id,
              bookingDate: existing.booking_date,
              treatmentCategory: existing.treatment_category,
              tenantId: existing.tenant_id || tenantId,
            });
          } else if (status === 'completed' && existing.booking_date) {
            const { reservationLifecycleService } = await import('../../services/reservation-lifecycle.service');
            await reservationLifecycleService.onReservationCompleted({
              customerId: existing.customer_id,
              reservationId: id,
              bookingDate: existing.booking_date,
              treatmentCategory: existing.treatment_category,
              tenantId: existing.tenant_id || tenantId,
            });
          } else if (status === 'cancelled') {
            await followUpService.onReservationCancelled(id, existing.tenant_id || tenantId);
            if (existing.assigned_staff_id) {
              const cancelReason = (request.body as any)?.cancelReason || (request.body as any)?.reason || undefined;
              import('../../services/staff-notification.service').then(({ staffNotificationService }) => {
                staffNotificationService.sendReservationCancelledNotification(id, existing.assigned_staff_id!, cancelReason).catch((e: any) =>
                  console.warn('[Admin API] Failed to send Telegram cancelled notification (status patch):', e.message)
                );
              }).catch(() => {});
            }
          }
        } catch (fuErr: any) {
          console.warn('[Admin API] Failed to sync follow-ups on status update:', fuErr.message);
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_RESERVATION_STATUS',
          targetId: id,
          payload: { status },
          ipAddress: request.ip,
        });

        try {
          const { customerService } = await import('../../services/customer.service');
          await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId);
        } catch (ltvErr: any) {
          console.warn('[Admin API] Failed to recalculate ltv_cache on status change:', ltvErr.message);
        }

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === tenantId) {
          if (
            status === 'completed' &&
            mock.status !== 'completed' &&
            isPrematureCompletion(mock.booking_date) &&
            !(request.body as any)?.forceComplete
          ) {
            return reply.status(400).send({
              success: false,
              code: 'PREMATURE_COMPLETION_BLOCKED',
              error: 'Reservasi masa depan tidak dapat ditandai sebagai completed sebelum tanggal kunjungan tiba. Gunakan forceComplete: true bila ada persetujuan darurat.',
            });
          }
          if (status === 'confirmed' && mock.status !== 'confirmed') {
            mock.purchase_review_status = resolvePurchaseReviewOnConfirm(mock as any);
          }
          mock.status = status;
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation/:id/set-date
   */
  fastify.patch(
    '/api/admin/reservation/:id/set-date',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { bookingDate: string } }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      const { bookingDate } = request.body || {};
      if (!bookingDate) {
        return reply.status(400).send({ error: 'bookingDate is required' });
      }

      const parsedDate = new Date(bookingDate);
      if (isNaN(parsedDate.getTime())) {
        return reply.status(400).send({ error: 'Invalid date format. Use ISO string or YYYY-MM-DD.' });
      }

      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: { customer: true },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        const isForce = Boolean((request.body as any)?.force);
        if (existing.assigned_staff_id && existing.status !== 'cancelled' && !isForce) {
          const { findOverlappingStaffReservations } = await import('../../services/reservation-core.service');
          const staffConflicts = await findOverlappingStaffReservations({
            tenantId,
            staffId: existing.assigned_staff_id,
            bookingDate: parsedDate,
            durationMinutes: existing.duration_minutes ?? 60,
            excludeId: existing.id,
          });
          if (staffConflicts.length > 0) {
            return reply.status(409).send({
              success: false,
              code: 'STAFF_COLLISION',
              error: 'Jadwal terapis bentrok dengan reservasi lain.',
              conflict: staffConflicts[0],
            });
          }
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: { booking_date: parsedDate },
          include: {
            customer: { include: { children: true } },
            assigned_staff: { select: { id: true, name: true, phone: true } },
            children: true,
          },
        });

        try {
          const { followUpService } = await import('../../services/follow-up.service');
          await followUpService.onReservationRescheduled(id, parsedDate, existing.tenant_id || tenantId);
        } catch (fuErr: any) {
          console.warn('[Admin API] Failed to reschedule follow-ups on date update:', fuErr.message);
        }

        if (reservation.google_calendar_event_id) {
          try {
            const customerName = existing.customer?.name || 'Bunda';
            await googleCalendarService.updateEvent(reservation.google_calendar_event_id, reservation, customerName);
          } catch (err) {
            console.error('[Admin API] Google Calendar Event update failed:', err);
          }
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'SET_RESERVATION_DATE',
          targetId: id,
          payload: { bookingDate },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === tenantId) {
          mock.booking_date = parsedDate;
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );
}
