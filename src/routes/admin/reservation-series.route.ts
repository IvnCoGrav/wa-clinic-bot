import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { tenantOf } from './route-helpers';
import { auditService } from '../../services/audit.service';

/**
 * Reservation Series Routes — Paket multi-sesi reservasi.
 * Dipisah dari reservations.subroute.ts (God Controller) secara bertahap (Fase 2.3 audit arsitektur).
 * Routes: create, get, get-by-customer, pause, resume, cancel, session-management
 */
export async function reservationSeriesRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/admin/reservation-series
   * Create a multi-session reservation series.
   */
  fastify.post(
    '/api/admin/reservation-series',
    async (
      request: FastifyRequest<{
        Body: {
          customerId: string;
          treatmentName: string;
          treatmentCategory?: string;
          totalSessions: number;
          purchaseValue?: number;
          assignedStaffId?: string;
          notes?: string;
          sessions: Array<{
            sessionNumber: number;
            bookingDate: string;
            assignedStaffId?: string;
          }>;
          babies?: Array<{ name: string; ageText?: string }>;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { customerId, treatmentName, treatmentCategory, totalSessions, purchaseValue, assignedStaffId, notes, sessions, babies } =
        request.body || {};

      if (!customerId || !treatmentName || !totalSessions || !sessions?.length) {
        return reply.status(400).send({ success: false, error: 'customerId, treatmentName, totalSessions, dan sessions wajib diisi.' });
      }

      try {
        const { reservationSeriesService } = await import('../../services/reservation-series.service');
        const series = await reservationSeriesService.createSeries(
          { customerId, treatmentName, treatmentCategory, totalSessions, purchaseValue, assignedStaffId, notes, sessions, babies },
          tenantId
        );

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CREATE_RESERVATION_SERIES',
          targetId: series.id,
          payload: { customerId, treatmentName, treatmentCategory, totalSessions, purchaseValue, sessionCount: sessions.length },
          ipAddress: request.ip,
        });

        return reply.status(201).send({ success: true, data: series });
      } catch (err: any) {
        // Fase 3.3: collision per sesi ΓåÆ 409 dengan info sesi bentrok.
        if (err?.code === 'STAFF_COLLISION') {
          return reply.status(409).send({
            success: false,
            code: 'STAFF_COLLISION',
            error: `Jadwal terapis bentrok pada sesi ${err.sessionNumber ?? '?'}.`,
            conflict: err.conflict,
          });
        }
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/reservation-series/:id
   * Get a single series with all sessions.
   */
  fastify.get(
    '/api/admin/reservation-series/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      try {
        const { reservationSeriesService } = await import('../../services/reservation-series.service');
        const series = await reservationSeriesService.getSeries(request.params.id, tenantId);
        if (!series) return reply.status(404).send({ success: false, error: 'Series tidak ditemukan.' });
        return reply.status(200).send({ success: true, data: series });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/reservation-series/customer/:customerId
   * Get all active series for a customer.
   */
  fastify.get(
    '/api/admin/reservation-series/customer/:customerId',
    async (request: FastifyRequest<{ Params: { customerId: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      try {
        const { reservationSeriesService } = await import('../../services/reservation-series.service');
        const series = await reservationSeriesService.getCustomerSeries(request.params.customerId, tenantId);
        return reply.status(200).send({ success: true, data: series });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation-series/:id/pause
   * Pause remaining sessions.
   */
  fastify.patch(
    '/api/admin/reservation-series/:id/pause',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      try {
        const { reservationSeriesService } = await import('../../services/reservation-series.service');
        const result = await reservationSeriesService.pauseSeries(request.params.id, tenantId);
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'PAUSE_RESERVATION_SERIES',
          targetId: request.params.id,
          payload: result,
          ipAddress: request.ip,
        });
        return reply.status(200).send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation-series/:id/resume
   * Resume a paused series.
   */
  fastify.patch(
    '/api/admin/reservation-series/:id/resume',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      try {
        const { reservationSeriesService } = await import('../../services/reservation-series.service');
        const result = await reservationSeriesService.resumeSeries(request.params.id, tenantId);
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'RESUME_RESERVATION_SERIES',
          targetId: request.params.id,
          payload: result,
          ipAddress: request.ip,
        });
        return reply.status(200).send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation-series/:id/cancel
   * Cancel remaining sessions.
   */
  fastify.patch(
    '/api/admin/reservation-series/:id/cancel',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      try {
        const { reservationSeriesService } = await import('../../services/reservation-series.service');
        const result = await reservationSeriesService.cancelSeries(request.params.id, tenantId);
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CANCEL_RESERVATION_SERIES',
          targetId: request.params.id,
          payload: result,
          ipAddress: request.ip,
        });
        return reply.status(200).send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation-series/:id/session/:reservationId
   * Update a single session (date, staff, or status).
   */
  fastify.patch(
    '/api/admin/reservation-series/:id/session/:reservationId',
    async (
      request: FastifyRequest<{
        Params: { id: string; reservationId: string };
        Body: { bookingDate?: string; assignedStaffId?: string; status?: string };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      // Dual-casing toleran (camel Γê¬ snake) untuk kontrak session
      const rawBody = (request.body || {}) as any;
      const body: any = { ...rawBody };
      if (body.bookingDate === undefined && body.booking_date !== undefined) body.bookingDate = body.booking_date;
      if (body.assignedStaffId === undefined && body.assigned_staff_id !== undefined) body.assignedStaffId = body.assigned_staff_id;
      const { bookingDate, assignedStaffId, status } = body;
      try {
        const { reservationSeriesService } = await import('../../services/reservation-series.service');
        const updated = await reservationSeriesService.updateSession(
          request.params.reservationId,
          { bookingDate, assignedStaffId, status },
          tenantId
        );
        // Auto-check if series is now complete
        await reservationSeriesService.checkAndCompleteSeries(request.params.id, tenantId);
        return reply.status(200).send({ success: true, data: updated });
      } catch (err: any) {
        if (err?.code === 'STAFF_COLLISION') {
          return reply.status(409).send({
            success: false,
            code: 'STAFF_COLLISION',
            error: 'Jadwal terapis bentrok dengan reservasi lain.',
            conflict: err.conflict,
          });
        }
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );
}

export default reservationSeriesRoutes;
