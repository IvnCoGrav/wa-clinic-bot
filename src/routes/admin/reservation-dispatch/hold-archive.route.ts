import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { tenantOf } from '../route-helpers';
import { memoryReservations } from '../stores';
import { auditService } from '../../../services/audit.service';
import { reservationStatusService } from '../../../services/reservation-status.service';
import { reservationArchiveService } from '../../../services/reservation-archive.service';

export async function registerHoldArchiveRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * PATCH /api/admin/reservation/:id/release-hold
   * Melepas slot hold -> transisi ke cancelled (audit utuh) + hook LTV/follow-up.
   */
  fastify.patch(
    '/api/admin/reservation/:id/release-hold',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const tenantId = tenantOf(request);
      // Memory fallback first (untuk test offline & hold yang dibuat via fallback)
      const mem = memoryReservations.get(id);
      if (mem) {
        // Fail-closed: entri tanpa tenant_id sekalipun DILARANG lolos isolasi
        // tenant (jangan hanya menolak bila tenant_id ada & berbeda).
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
          const { customerService } = await import('../../../services/customer.service');
          await customerService.recalculateCustomerLtv(reservation.customer_id, tenantId);
        } catch {}
        try {
          const { followUpService } = await import('../../../services/follow-up.service');
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
   * GET /api/admin/reservation/archive
   * Mengambil daftar arsip reservasi
   */
  fastify.get(
    '/api/admin/reservation/archive',
    async (
      request: FastifyRequest<{
        Querystring: {
          limit?: string;
          offset?: string;
          search?: string;
          includeRestored?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      try {
        const result = await reservationArchiveService.listArchives({
          tenantId,
          limit: request.query.limit ? parseInt(request.query.limit, 10) : 20,
          offset: request.query.offset ? parseInt(request.query.offset, 10) : 0,
          search: request.query.search,
          includeRestored: request.query.includeRestored === 'true',
        });
        return reply.status(200).send({ success: true, ...result });
      } catch (err: any) {
        return reply.status(500).send({ success: false, message: err?.message });
      }
    }
  );

  /**
   * POST /api/admin/reservation/archive/:id/restore
   * Memulihkan reservasi dari arsip ke daftar aktif
   */
  fastify.post(
    '/api/admin/reservation/archive/:id/restore',
    async (
      request: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      try {
        const result = await reservationArchiveService.restoreReservation({
          archiveId: id,
          tenantId,
          actor: (request as any).adminIdentity,
          apiKey: (request as any).adminKeyUsed,
          ipAddress: request.ip,
        });
        return reply.status(200).send({ success: true, message: result.message, reservationId: result.reservationId });
      } catch (err: any) {
        return reply.status(400).send({ success: false, message: err?.message });
      }
    }
  );
}
