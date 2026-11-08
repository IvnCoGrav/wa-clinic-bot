import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { tenantOf } from '../route-helpers';
import { memoryReservations } from '../stores';
import { auditService } from '../../../services/audit.service';
import { customerService } from '../../../services/customer.service';
import { googleCalendarService } from '../../../services/google-calendar.service';
import { reservationArchiveService } from '../../../services/reservation-archive.service';
import {
  reservationStatusService,
  InvalidTransitionError,
} from '../../../services/reservation-status.service';

export async function registerDeleteRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * DELETE /api/admin/reservation/:id
   * Kontrak (lihat KNOWN_ISSUES #300):
   * - tanpa query   -> ARSIP (snapshot 60 hari, baris aktif dihapus)
   * - ?archive=true -> @deprecated ARSIP (alias eksplisit historis)
   * - ?hard=true    -> @deprecated ARSIP (alias historis, BUKAN hard delete fisik)
   * - ?soft=true    -> SOFT-CANCEL (status = 'cancelled', baris tetap ada)
   */
  fastify.delete(
    '/api/admin/reservation/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { hard?: string; archive?: string; soft?: string; reason?: string };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      const isSoftCancel = request.query?.soft === 'true';
      const reason = request.query?.reason;

      let existing: any = null;
      let dbUnavailable = false;
      try {
        existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: { customer: true },
        });
      } catch (dbErr: any) {
        dbUnavailable = true;
        console.warn(`[Admin API] DELETE reservasi ${id}: DB tidak dapat diakses, cek memory store:`, dbErr?.message);
      }

      if (!existing) {
        const mem = memoryReservations.get(id);
        const memUsable = mem && mem.tenant_id === tenantId;
        if (!memUsable) {
          if (dbUnavailable) {
            return reply.status(503).send({
              success: false,
              code: 'DB_UNAVAILABLE',
              error: 'Basis data tidak dapat diakses. Reservasi TIDAK dihapus/diarsipkan. Silakan coba lagi.',
            });
          }
          return reply.status(404).send({ success: false, error: 'Reservation not found' });
        }
        if (!isSoftCancel) {
          memoryReservations.delete(id);
          await customerService.recalculateCustomerLtv(mem.customer_id, tenantId).catch(() => {});
          return reply.status(200).send({ success: true, message: 'Reservasi berhasil diarsipkan (memory).' });
        }
        mem.status = 'cancelled';
        mem.updated_at = new Date();
        memoryReservations.set(id, mem);
        await customerService.recalculateCustomerLtv(mem.customer_id, tenantId).catch(() => {});
        return reply.status(200).send({ success: true, data: mem, note: 'Fallback in-memory mode' });
      }

      try {
        // Kontrak A-013: default adalah ARSIP kecuali ?soft=true
        const isArchive = !isSoftCancel;

        if (isArchive) {
          // reservationArchiveService.archiveReservation sudah menangani penghapusan
          // event Google Calendar (jika ada) di dalam servicenya. DILARANG memanggil
          // deleteEvent lagi di level route agar tidak terjadi dobel panggilan.
          const archiveResult = await reservationArchiveService.archiveReservation({
            id,
            tenantId: existing.tenant_id || tenantId,
            actor: (request as any).adminIdentity,
            apiKey: (request as any).adminKeyUsed,
            reason,
            ipAddress: request.ip,
          });

          return reply.status(200).send({
            success: true,
            message: 'Reservasi berhasil diarsipkan (disimpan 60 hari dan dapat dipulihkan).',
            archiveId: archiveResult.archiveId,
            restoreUntil: archiveResult.restoreUntil,
          });
        }

        // Jalur SOFT-CANCEL (?soft=true): hapus event Google Calendar di sini sebelum transisi
        if (existing.google_calendar_event_id) {
          try {
            await googleCalendarService.deleteEvent(existing.google_calendar_event_id);
          } catch (err: any) {
            console.error('[Admin API] Google Calendar Event deletion failed (soft-cancel):', err?.message || err);
          }
        }

        const applied = await reservationStatusService.applyTransition(existing, {
          to: 'cancelled',
        });
        if (!applied.ok) {
          return reply.status(409).send({
            success: false,
            code: 'ILLEGAL_TRANSITION',
            error: `Transisi ${existing.status} → cancelled ditolak.`,
          });
        }
        const reservation = applied.reservation;

        // Audit P1-14: batalkan follow-up pengingat H-1 / review H+1 terkait
        // reservasi yang dibatalkan (sebelumnya hanya membuat NO_PURCHASE baru).
        try {
          const { followUpService } = await import('../../../services/follow-up.service');
          await followUpService.onReservationCancelled(id, existing.tenant_id || tenantId);
        } catch (_) {}

        if (existing.assigned_staff_id) {
          const cancelReason = reason || undefined;
          import('../../../services/staff-notification.service').then(({ staffNotificationService }) => {
            staffNotificationService.sendReservationCancelledNotification(id, existing.assigned_staff_id!, cancelReason).catch((e: any) =>
              console.warn('[Admin API] Failed to send Telegram cancelled (soft delete):', e.message)
            );
          }).catch(() => {});
        }

        await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId).catch(() => {});

        // Kebijakan CAPI: Reservasi yang sudah approved lalu cancelled diaudit (Meta tidak bisa menarik event yang sudah terkirim)
        if (existing.purchase_review_status === 'approved' || Boolean((existing as any).purchase_event_sent_at)) {
          await auditService.logAdminAction({
            apiKey: (request as any).adminKeyUsed,
            adminIdentity: (request as any).adminIdentity,
            action: 'CANCEL_AFTER_APPROVE',
            targetId: id,
            payload: {
              previousStatus: existing.status,
              purchase_event_sent_at: existing.purchase_event_sent_at,
              reason: reason || 'RESERVATION_CANCELLED_POST_CAPI_APPROVE',
            },
            ipAddress: request.ip,
          }).catch(() => {});
        }

        const activeNoPurchaseFollowUps = await prisma.followUp.findFirst({
          where: {
            customer_id: existing.customer_id,
            type: 'NO_PURCHASE',
            status: { in: ['PENDING', 'QUEUED'] },
            tenant_id: tenantId,
          },
        });

        if (!activeNoPurchaseFollowUps) {
          const stages = [1, 2, 3];
          const days = [3, 7, 14];
          const targetTenantId = existing.tenant_id || tenantId;
          const followUpRecords = stages.map((stage, idx) => {
            const scheduledAt = new Date();
            scheduledAt.setDate(scheduledAt.getDate() + days[idx]);
            return {
              tenant_id: targetTenantId,
              customer_id: existing.customer_id,
              type: 'NO_PURCHASE' as const,
              stage,
              scheduled_at: scheduledAt,
              status: 'PENDING' as const,
            };
          });
          await prisma.followUp.createMany({ data: followUpRecords });
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CANCEL_RESERVATION',
          targetId: id,
          payload: { status: 'cancelled' },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error: any) {
        if (error instanceof InvalidTransitionError) {
          return reply.status(409).send({
            success: false,
            code: 'ILLEGAL_TRANSITION',
            error: error.message,
          });
        }
        const msg = String(error?.message || error);
        const isDbDown = /Database offline|ECONNREFUSED|ETIMEDOUT|P1001|P1002|P2024|connection|timed out/i.test(msg);
        console.error(`[Admin API] DELETE reservasi ${id} gagal:`, msg);
        return reply.status(isDbDown ? 503 : 500).send({
          success: false,
          code: isDbDown ? 'DB_UNAVAILABLE' : 'DELETE_FAILED',
          error: isDbDown
            ? 'Basis data tidak dapat diakses. Reservasi TIDAK dihapus/diarsipkan. Silakan coba lagi.'
            : 'Gagal memproses penghapusan reservasi.',
        });
      }
    }
  );
}
