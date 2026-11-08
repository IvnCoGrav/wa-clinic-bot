import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { tenantOf } from '../route-helpers';
import { memoryReservations } from '../stores';
import { auditService } from '../../../services/audit.service';
import { googleCalendarService } from '../../../services/google-calendar.service';
import { resolvePurchaseReviewOnConfirm } from '../../../services/capi-review-status';
import { isPrematureCompletion } from '../../../domain/reservation-status';

export async function registerStatusRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * PATCH /api/admin/reservation/:id/status
   * Mengubah status reservasi secara fleksibel ('hold' | 'confirmed' | 'completed' | 'cancelled')
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

        const { canTransition: canT2, isHoldActive: isHA2, isHoldActiveByCreated: isHAC2 } = await import('../../../domain/reservation-status');
        if (!canT2(existing.status, status)) {
          return reply.status(409).send({ success: false, code: 'ILLEGAL_TRANSITION', error: `Transisi ${existing.status} → ${status} ditolak.` });
        }
        if (existing.status === 'hold' && status === 'confirmed') {
          const holdOk2 = isHA2(existing.booking_date as any) && isHAC2((existing as any).created_at as any);
          if (!holdOk2) {
            return reply.status(409).send({ success: false, code: 'HOLD_EXPIRED', error: 'Hold sudah kedaluwarsa.' });
          }
        }
        // Guard anti-completed prematur: forceComplete terpisah dari `force`
        // (yang dipakai bypass STAFF_COLLISION di bawah).
        if (status === 'completed' && isPrematureCompletion(existing.booking_date) && !(request.body as any)?.forceComplete) {
          return reply.status(400).send({
            success: false,
            code: 'PREMATURE_COMPLETION_BLOCKED',
            error: 'Reservasi masa depan tidak dapat ditandai sebagai completed sebelum tanggal kunjungan tiba. Gunakan forceComplete: true bila ada persetujuan darurat.',
          });
        }

        // Gate keras 6.1: Wajibkan bidan saat completed
        if (status === 'completed' && !existing.assigned_staff_id && !(request.body as any)?.allowUnassignedStaff) {
          return reply.status(400).send({
            success: false,
            code: 'STAFF_ASSIGNMENT_REQUIRED',
            error: 'Reservasi tidak dapat diselesaikan tanpa penugasan bidan (assigned_staff_id). Tugaskan bidan terlebih dahulu atau sertakan allowUnassignedStaff: true.',
          });
        }

        // Fase 3.2: reaktivasi (cancelled/hold → confirmed) WAJIB dicek bentrok
        // terapis. Tanpa ini, terapis bisa double-booked tanpa terdeteksi.
        const isReactivatingToConfirmed = status === 'confirmed' && existing.status !== 'confirmed';
        const forceStatus = Boolean((request.body as any)?.force);
        if (isReactivatingToConfirmed && existing.assigned_staff_id && existing.booking_date && !forceStatus) {
          const { findOverlappingStaffReservations } = await import('../../../services/reservation-core.service');
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
          const { followUpService } = await import('../../../services/follow-up.service');
          if (status === 'confirmed' && existing.booking_date) {
            await followUpService.createReservationFollowUps({
              reservationId: id,
              customerId: existing.customer_id,
              bookingDate: existing.booking_date,
              treatmentCategory: existing.treatment_category,
              tenantId: existing.tenant_id || tenantId,
            });
          } else if (status === 'completed' && existing.booking_date) {
            const { reservationLifecycleService } = await import('../../../services/reservation-lifecycle.service');
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
              import('../../../services/staff-notification.service').then(({ staffNotificationService }) => {
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

        // Phase 4: Sync ltv_cache on reservation status change
        try {
          const { customerService } = await import('../../../services/customer.service');
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
          const { findOverlappingStaffReservations } = await import('../../../services/reservation-core.service');
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
          const { followUpService } = await import('../../../services/follow-up.service');
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
