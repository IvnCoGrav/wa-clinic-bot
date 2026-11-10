import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { tenantOf } from './route-helpers';
import { auditService } from '../../services/audit.service';
import { alertService, AlertType, AlertSeverity } from '../../services/alert.service';
import { StaffReservationService } from '../../services/staff-reservation.service';
import {
  staffTripTrackingService,
  calculateTripProgress,
  evaluateGeofenceAlert,
  calculateDelayStatus,
} from '../../services/staff-trip-tracking.service';
import { reservationArchiveService } from '../../services/reservation-archive.service';

export async function reservationDispatchTripRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/dispatch/trip/:reservationId
   * Data realtime perjalanan terapis untuk widget CS (posisi, sisa jarak, ETA,
   * flag geofence anti-lost, dan teks jawaban siap kirim — DB-driven).
   */
  fastify.get(
    '/api/admin/dispatch/trip/:reservationId',
    async (request: FastifyRequest<{ Params: { reservationId: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      const { reservationId } = request.params;
      if (!reservationId) {
        return reply.status(400).send({ success: false, error: 'reservationId wajib disertakan.' });
      }

      let reservation: any = null;
      try {
        reservation = await prisma.reservation.findUnique({
          where: { id: reservationId },
          include: {
            customer: {
              select: {
                name: true,
                phone: true,
                lat: true,
                lng: true,
                kelurahan: true,
                kecamatan: true,
                kota: true,
                ongkir: true,
                distance_km: true,
                preferences: true,
                children: true,
              },
            },
            assigned_staff: { select: { name: true, phone: true } },
            children: true,
          },
        });
      } catch {
        reservation = null;
      }
      if (!reservation || reservation.tenant_id !== tenantId) {
        return reply.status(404).send({ success: false, error: 'Reservasi tidak ditemukan.' });
      }

      const trip = staffTripTrackingService.getTrip(tenantId, reservationId);
      const customerLat = reservation.customer?.lat;
      const customerLng = reservation.customer?.lng;
      const now = Date.now();

      let remainingKm: number | null = null;
      let etaMinutes: number | null = null;
      let isStalledOutsideTarget = false;
      let geofenceReason: string | null = null;
      let geofenceDistanceM: number | null = null;

      if (trip) {
        const progress = calculateTripProgress(trip.lat, trip.lng, customerLat, customerLng);
        if (progress) {
          remainingKm = progress.remainingKm;
          etaMinutes = progress.etaMinutes;
        }
        const stalledSec = Math.max(0, Math.round((now - trip.movedAt) / 1000));
        const geo = evaluateGeofenceAlert(
          trip.lat,
          trip.lng,
          customerLat,
          customerLng,
          trip.speed,
          trip.accuracy,
          stalledSec
        );
        isStalledOutsideTarget = geo.isStalledOutsideTarget;
        geofenceReason = geo.reason;
        geofenceDistanceM = geo.distanceM;
      }

      // Prediksi keterlambatan (ETA vs jadwal) — murni, tanpa I/O.
      const delayStatus = calculateDelayStatus(
        (reservation as any).booking_date ?? null,
        etaMinutes
      );

      let readyText = '';
      try {
        readyText = await StaffReservationService.getTripStatusMessageText(tenantId, {
          patientName: reservation.customer?.name || 'Bunda',
          areaName: trip?.areaName || null,
          etaMinutes,
          variantKey: reservationId,
        });
      } catch {
        readyText = '';
      }

      let delayText = '';
      if (delayStatus.isDelayed) {
        try {
          delayText = await StaffReservationService.getTripDelayMessageText(tenantId, {
            patientName: reservation.customer?.name || 'Bunda',
            delayMinutes: delayStatus.delayMinutes,
            arrivalTime: delayStatus.formattedArrivalWib,
            variantKey: reservationId,
          });
        } catch {
          delayText = '';
        }
      }

      return reply.status(200).send({
        success: true,
        data: {
          reservationId,
          status: reservation.status,
          otwSentAt: reservation.otw_sent_at || null,
          arrivedAt: reservation.arrived_at || null,
          staffName: reservation.assigned_staff?.name || null,
          staffPhone: reservation.assigned_staff?.phone || null,
          trip: trip
            ? {
                lat: trip.lat,
                lng: trip.lng,
                speed: trip.speed,
                heading: trip.heading,
                accuracy: trip.accuracy,
                areaName: trip.areaName,
                updatedAt: trip.updatedAt,
                lastUpdateSec: Math.max(0, Math.round((now - trip.updatedAt) / 1000)),
                /** Provenance titik awal: 'gps' (presisi) vs estimasi (prev_patient/clinic/unknown). */
                originSource: trip.originSource || 'unknown',
              }
            : null,
          customerCoords: { lat: customerLat ?? null, lng: customerLng ?? null },
          customer: {
            name: reservation.customer?.name || null,
            phone: reservation.customer?.phone || null,
            kelurahan: reservation.customer?.kelurahan || null,
            kecamatan: reservation.customer?.kecamatan || null,
            kota: reservation.customer?.kota || null,
            ongkir: reservation.customer?.ongkir ?? null,
            distance_km: reservation.customer?.distance_km ?? null,
            children: reservation.customer?.children || [],
            preferences: {
              address: (reservation.customer as any)?.preferences?.address || null,
              full_address: (reservation.customer as any)?.preferences?.full_address || null,
              landmark: (reservation.customer as any)?.preferences?.landmark || null,
              address_notes: (reservation.customer as any)?.preferences?.address_notes || null,
            },
          },
          treatmentDetail: reservation.treatment_detail || null,
          children: reservation.children || [],
          remainingKm,
          etaMinutes,
          isStalledOutsideTarget,
          geofenceReason,
          geofenceDistanceM,
          delayStatus,
          readyText,
          delayText,
        },
      });
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

  /**
   * PATCH /api/admin/reservation/:id/assign-staff
   * Menugaskan atau mengubah penugasan staff (terapis) pada reservasi.
   */
  fastify.patch(
    '/api/admin/reservation/:id/assign-staff',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { assigned_staff_id?: string | null } }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      const { assigned_staff_id } = request.body || {};

      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: { customer: true },
        });
        if (!existing) {
          return reply.status(404).send({ success: false, error: 'Reservasi tidak ditemukan.' });
        }

        let staffName: string | null = null;
        if (assigned_staff_id) {
          const staff = await prisma.staff.findFirst({
            where: { id: assigned_staff_id, tenant_id: tenantId },
            select: { id: true, name: true },
          });
          if (!staff) {
            return reply.status(400).send({ success: false, error: 'Staff yang dipilih tidak valid.' });
          }
          staffName = staff.name;
        }

        const isForce = Boolean((request.body as any)?.force);
        if (assigned_staff_id && existing.booking_date && existing.status !== 'cancelled' && !isForce) {
          const { findOverlappingStaffReservations } = await import('../../services/reservation-core.service');
          const staffConflicts = await findOverlappingStaffReservations({
            tenantId,
            staffId: assigned_staff_id,
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

        const reservation = await prisma.reservation.update({
          where: { id },
          data: { assigned_staff_id: assigned_staff_id || null },
          include: {
            assigned_staff: {
              select: { id: true, name: true, phone: true },
            },
          },
        });

        // 6.3 Log pergantian penugasan bidan (ReservationStaffAssignmentLog) + API-11 Alerting
        if (existing?.assigned_staff_id !== (assigned_staff_id || null)) {
          try {
            const p = prisma.reservationStaffAssignmentLog?.create({
              data: {
                tenant_id: tenantId,
                reservation_id: id,
                from_staff_id: existing?.assigned_staff_id || null,
                to_staff_id: assigned_staff_id || null,
                reason: (request.body as any)?.assignmentReason || (request.body as any)?.reason || 'cs_dispatch',
                actor: (request as any).adminUser?.name || (request as any).staffName || (request as any).adminIdentity || 'admin',
              },
            });
            void Promise.resolve(p).catch((err: any) => {
              console.warn('[STAFF-ASSIGN-LOG] Failed to create log on assign:', err.message);
              alertService.notifyAlert({
                type: AlertType.STAFF_ASSIGNMENT_LOG_FAILED,
                severity: AlertSeverity.WARNING,
                message: `[STAFF-ASSIGN-LOG] Gagal membuat log penugasan staf: ${err.message}`,
                metadata: { reservationId: id, tenantId, toStaffId: assigned_staff_id },
              }).catch(() => {});
            });
          } catch (err: any) {
            console.warn('[STAFF-ASSIGN-LOG] Exception initiating log on assign:', err.message);
            alertService.notifyAlert({
              type: AlertType.STAFF_ASSIGNMENT_LOG_FAILED,
              severity: AlertSeverity.WARNING,
              message: `[STAFF-ASSIGN-LOG] Exception pembuatan log penugasan staf: ${err.message}`,
              metadata: { reservationId: id, tenantId, toStaffId: assigned_staff_id },
            }).catch(() => {});
          }
        }

        if (assigned_staff_id) {
          const { staffNotificationService } = await import('../../services/staff-notification.service');
          staffNotificationService.scheduleReservationAssignmentNotification(id, assigned_staff_id).catch((err) => {
            console.error('[Admin API] Failed to schedule staff notification on assign:', err.message);
          });
        }

        if ((reservation?.status || existing?.status) === 'completed') {
          import('../../services/sheets/sheets-sync.service')
            .then(({ sheetsSyncService }) => sheetsSyncService.enqueue(id, tenantId))
            .catch((err) => console.warn('[Admin API] sheets enqueue on assign failed:', err?.message));
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'ASSIGN_RESERVATION_STAFF',
          targetId: id,
          payload: { assigned_staff_id, staffName },
          ipAddress: request.ip,
          tenantId: tenantId,
        });

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error: any) {
        console.error('[Admin API] Failed to assign staff to reservation:', error.message);
        return reply.status(500).send({ success: false, error: 'Gagal menugaskan staff ke reservasi.' });
      }
    }
  );
}
