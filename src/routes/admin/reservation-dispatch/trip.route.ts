import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { tenantOf } from '../route-helpers';
import { StaffReservationService } from '../../../services/staff-reservation.service';
import {
  staffTripTrackingService,
  calculateTripProgress,
  evaluateGeofenceAlert,
  calculateDelayStatus,
} from '../../../services/staff-trip-tracking.service';

/**
 * GET /api/admin/dispatch/trip/:reservationId
 * Data realtime perjalanan terapis untuk widget CS (posisi, sisa jarak, ETA,
 * flag geofence anti-lost, dan teks jawaban siap kirim — DB-driven).
 */
export async function registerTripRoutes(fastify: FastifyInstance): Promise<void> {
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
}
