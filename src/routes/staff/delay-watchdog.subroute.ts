import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { StaffReservationService } from '../../services/staff-reservation.service';
import { staffDepartureWatchdogService } from '../../services/staff-departure-watchdog.service';
import { isStaffSupervisorRole } from '../../domain/staff-role';
import { resolveSessionTenantId } from '../admin/route-helpers';
import { loadAuthorizedReservation } from '../../services/staff-reservation-access.service';

export async function staffDelayWatchdogRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/staff/delay-template
   * Mengambil draf pesan pemberitahuan keterlambatan (DB-driven via STAFF_TRIP_DELAY).
   * Nama pasien di-load dari server (anti data falsification).
   * Tidak memaparkan nomor HP pasien ke staf (SOP no-HP).
   */
  fastify.get(
    '/api/staff/delay-template',
    async (
      request: FastifyRequest<{
        Querystring: { reservationId?: string; delayMinutes?: string; arrivalTime?: string };
      }>,
      reply: FastifyReply
    ) => {
      const reservationId = request.query?.reservationId;
      if (!reservationId) {
        return reply.status(400).send({ success: false, error: 'reservationId wajib disertakan.' });
      }

      const staffId = (request as any).staffId;
      const tenantId = resolveSessionTenantId(request);
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const isSupervisor = isStaffSupervisorRole(role);

      const auth = await loadAuthorizedReservation(reservationId, staffId, tenantId, isSupervisor);
      if (!auth.ok) return reply.status(auth.status).send({ success: false, error: auth.error });

      const patientName = auth.reservation?.customer?.name || 'Bunda';
      const delayMinutes = request.query?.delayMinutes ? parseInt(request.query.delayMinutes, 10) : undefined;
      const arrivalTime = request.query?.arrivalTime;

      const text = await StaffReservationService.getTripDelayMessageText(tenantId, {
        patientName,
        delayMinutes,
        arrivalTime,
        variantKey: reservationId,
      });

      return reply.status(200).send({ success: true, text });
    }
  );

  /**
   * POST /api/staff/reservations/:id/notify-delay
   * Mengirimkan notifikasi keterlambatan bidan ke nomor WhatsApp admin resmi klinik.
   * Dilindungi guard ownership + rate limit 5/menit + bodyLimit 2KB.
   * Hanya mengembalikan recipientCount (tanpa nomor HP).
   */
  fastify.post(
    '/api/staff/reservations/:id/notify-delay',
    { bodyLimit: 2 * 1024, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body?: { force?: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const tenantId = resolveSessionTenantId(request);
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const isSupervisor = isStaffSupervisorRole(role);
      const reservationId = request.params.id;
      const force = Boolean(request.body?.force && isSupervisor);

      const result = await staffDepartureWatchdogService.notifyDelayToAdmin({
        reservationId,
        staffId,
        tenantId,
        isSupervisor,
        force,
      });

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          code: result.code,
          error: result.error,
        });
      }

      return reply.status(200).send({
        success: true,
        recipientCount: result.recipientCount,
      });
    }
  );
}
