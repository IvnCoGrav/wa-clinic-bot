import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { tenantOf } from '../route-helpers';
import { memoryReservations } from '../stores';
import { auditService } from '../../../services/audit.service';
import { googleCalendarService } from '../../../services/google-calendar.service';
import { resolvePurchaseReviewOnConfirm } from '../../../services/capi-review-status';
import { reservationStatusService } from '../../../services/reservation-status.service';
import { isPrematureCompletion } from '../../../domain/reservation-status';
import {
  completeReservationById,
  runCompletionSideEffects,
  BULK_COMPLETE_MAX_IDS,
  CompleteOutcome,
} from './shared';

export async function registerLifecycleRoutes(fastify: FastifyInstance): Promise<void> {
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
        const { canTransition, isHoldActive, isHoldActiveByCreated } = await import('../../../domain/reservation-status');
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
            const { followUpService } = await import('../../../services/follow-up.service');
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

        // CAPI Purchase decoupled: event Purchase HANYA via Meta Purchase Queue (POST /api/admin/reservation/:id/approve-purchase)
        // — Tandai Lunas / Confirm tidak lagi auto-trigger CAPI & tidak set purchase_event_sent_at.

        // Mandat Mutlak Anti-Label WAHA: pelunasan melepas label lifecycle via DB
        // internal (tabel CustomerLabel) — zero mutasi label WAHA.
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

          // CAPI decoupled — mock juga tidak kirim Purchase & tidak set purchase_event_sent_at.

          // Mandat Mutlak Anti-Label WAHA: memory-fallback juga DB-only (zero WAHA label).
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
            // Guard anti-completed prematur: jangan tandai selesai jadwal > 24 jam
            // ke depan (salah klik admin). forceComplete:true utk approval darurat.
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
          // NOT_FOUND → lempar agar jatuh ke fallback memori / 404 (perilaku lama).
          throw new Error('Reservation not found');
        }

        // MT-1.4: seam terpusat completed — dekopling REVIEW/NEXT + reset V3 episodik
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
   * Menandai selesai (status: 'completed') sekumpulan reservasi sekaligus.
   */
  fastify.post(
    '/api/admin/reservations/bulk-complete',
    async (
      request: FastifyRequest<{ Body: { ids?: unknown; forceComplete?: boolean; allowUnassignedStaff?: boolean } }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const rawIds = (request.body as any)?.ids;

      if (!Array.isArray(rawIds)) {
        return reply.status(400).send({ success: false, code: 'INVALID_BODY', error: 'Field "ids" wajib berupa array of string.' });
      }

      // Trim + buang non-string/kosong, lalu dedupe (pertahankan urutan).
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

      // Preflight DB: pastikan koneksi hidup SEBELUM mutasi apa pun (anti setengah jalan).
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
          // DB error mid-batch: laporkan sebagai SKIP agar sisa batch tetap diproses
          // (tidak menggantung di 503 setelah sebagian sukses).
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
}
