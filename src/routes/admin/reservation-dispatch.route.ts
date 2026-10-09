import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { tenantOf, sanitizeDurationMinutes } from './route-helpers';
import { auditService } from '../../services/audit.service';
import { customerService } from '../../services/customer.service';
import { googleCalendarService } from '../../services/google-calendar.service';
import {
  capiService,
  resolveTreatmentValue,
  extractValueByFormat,
  getTenantCapiFormats,
  resolveCanonicalLandingUrl,
} from '../../services/capi.service';
import { extractRupiahAmount } from '../../services/purchase-detection.service';
import {
  parseReservationText,
  extractBabyDetails,
  extractNotesFromRawText,
  mergeNotesIntoRawText,
} from '../../utils/reservation-text-parser';
import { parsePaymentSection } from '../../utils/conversation-transaction-extractor';
import { isPrematureCompletion } from '../../domain/reservation-status';
import { treatmentCatalogService } from '../../services/treatment-catalog.service';
import { StaffReservationService } from '../../services/staff-reservation.service';
import {
  staffTripTrackingService,
  calculateTripProgress,
  evaluateGeofenceAlert,
  calculateDelayStatus,
} from '../../services/staff-trip-tracking.service';
import { memoryReservations, filterMemoryByTenant } from './stores';
import { shouldExcludeFromCapiQueue } from '../../utils/dummy-filter';
import { wibDayRangeToUtc } from '../../utils/time-wib';
import { responseCacheService } from '../../services/response-cache.service';

/**
// Fase 2.1: getCatalogFallbackPrice dihapus — dilarang menebak harga layanan Baby secara sembarangan
// Nilai transaksi wajib terdeteksi dari data reservasi atau diisi eksplisit oleh admin via customPayload.

/**
 * Hasil operasi tandai-selesai. `reason` hanya terisi saat gagal, dan dipetakan
 * ke kode HTTP oleh tiap pemanggil (satuan → 400/404; bulk → masuk `skipped`).
 */
type CompleteOutcome =
  | { ok: true; reservation: any; existing: any }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_ELIGIBLE' | 'PREMATURE' };

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
async function completeReservationById(opts: {
  id: string;
  tenantId: string;
  strict: boolean;
  forceComplete?: boolean;
}): Promise<CompleteOutcome> {
  const existing = await prisma.reservation.findFirst({
    where: { id: opts.id, tenant_id: opts.tenantId },
  });
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };

  if (opts.strict) {
    const { canTransition } = await import('../../domain/reservation-status');
    if (!canTransition(existing.status, 'completed')) return { ok: false, reason: 'NOT_ELIGIBLE' };
  }

  if (isPrematureCompletion(existing.booking_date) && !opts.forceComplete) {
    return { ok: false, reason: 'PREMATURE' };
  }

  const reservation = await prisma.reservation.update({
    where: { id: opts.id },
    data: { status: 'completed' },
    include: {
      customer: { include: { children: true } },
      assigned_staff: { select: { id: true, name: true, phone: true } },
      children: true,
    },
  });
  return { ok: true, reservation, existing };
}

/**
 * Efek samping terpusat setelah status `completed` tersimpan (MT-1.4):
 * jadwal follow-up/review + next-treatment + reset sesi V3 episodik. Best-effort:
 * kegagalan tidak pernah melempar ke pemanggil. `existing` = baris SEBELUM update.
 */
async function runCompletionSideEffects(existing: any, tenantId: string): Promise<void> {
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
      // Tanpa booking_date: tetap reset sesi V3
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
const BULK_COMPLETE_MAX_IDS = 50;

/**
 * Reservation Dispatch Routes — Operasional dispatch/manajemen reservasi.
 * Dipisah dari reservations.subroute.ts (God Controller) secara bertahap (Fase 2.3 audit arsitektur).
 * Routes: trip, release-hold, detail, confirm, complete, bulk-complete, edit, status, set-date, proof, assign-staff, delete, approve/reject, capi-queue
 */
export async function reservationDispatchRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/dispatch/trip/:reservationId
   * Data realtime perjalanan terapis untuk widget CS (posisi, sisa jarak, ETA,
   * flag geofence anti-lost, dan teks jawaban siap kirim ΓÇö DB-driven).
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

      // Prediksi keterlambatan (ETA vs jadwal) ΓÇö murni, tanpa I/O.
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
        const cancelled = await prisma.reservation.update({ where: { id: reservation.id }, data: { status: 'cancelled' } });
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
   * GET /api/admin/reservation/:id
   * Ambil detail single reservation lengkap dengan customer, children, staff
   */
  fastify.get(
    '/api/admin/reservation/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const tenantId = tenantOf(request);
      try {
        const reservation = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: {
            customer: {
              include: {
                adClick: true,
                children: true,
                reservations: {
                  where: { status: { notIn: ['cancelled', 'rejected'] } },
                  select: { id: true, purchase_value: true },
                },
              },
            },
            assigned_staff: {
              select: { id: true, name: true, phone: true },
            },
          },
        });
        if (!reservation) {
          // memory fallback
          const mem = memoryReservations.get(id);
          if (!mem || mem.tenant_id !== tenantId) return reply.status(404).send({ success: false, error: 'Reservation tidak ditemukan' });
          // Paritas relasi DB: lengkapi assigned_staff bila belum ada (tanpa hardcode nama)
          let memStaff: any = mem.assigned_staff || null;
          if (!memStaff && mem.assigned_staff_id) {
            try {
              const s = await prisma.staff.findFirst({
                where: { id: mem.assigned_staff_id, tenant_id: tenantId },
                select: { id: true, name: true, phone: true },
              });
              memStaff = s || null;
            } catch {
              memStaff = null;
            }
          }
          return reply.status(200).send({
            success: true,
            data: {
              ...mem,
              assigned_staff: memStaff,
              notes: (mem as any).notes || extractNotesFromRawText(mem.raw_text),
              baby_details: extractBabyDetails(mem.raw_text),
            },
          });
        }
        const { computeCurrentAge, resolveMomGestationalInfo } = await import('../../utils/age-calculator');
        const enrichedChildren = ((reservation as any).customer?.children || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          birth_date: c.birth_date,
          raw_age_text: c.raw_age_text,
          age_months_at_registration: c.age_months_at_registration,
          current_age: computeCurrentAge({
            birthDate: c.birth_date,
            ageMonthsAtRegistration: c.age_months_at_registration,
            registeredAt: c.created_at,
            rawAgeText: c.raw_age_text,
          }),
        }));
        return reply.status(200).send({
          success: true,
          data: {
            ...reservation,
            notes: (reservation as any).notes || extractNotesFromRawText(reservation.raw_text),
            baby_details: extractBabyDetails(reservation.raw_text),
            mom_gestational_info: resolveMomGestationalInfo({
              text: `${(reservation as any).raw_text || ''} ${(reservation as any).treatment_detail || ''}`,
              treatmentCategory: (reservation as any).treatment_category,
              registeredAt: (reservation as any).created_at,
            }),
            customer: (reservation as any).customer
              ? { ...(reservation as any).customer, children: enrichedChildren }
              : undefined,
          },
        });
      } catch (err: any) {
        const mem = memoryReservations.get(id);
        if (mem && mem.tenant_id === tenantId) {
          return reply.status(200).send({
            success: true,
            data: {
              ...mem,
              notes: (mem as any).notes || extractNotesFromRawText(mem.raw_text),
              baby_details: extractBabyDetails(mem.raw_text),
            },
          });
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
          return reply.status(409).send({ success: false, code: 'ILLEGAL_TRANSITION', error: `Transisi ${existing.status} ΓåÆ confirmed ditolak.` });
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

        const reservation = await prisma.reservation.update({
          where: { id },
          data: {
            status: 'confirmed',
            google_calendar_event_id: calendarEventId,
            needs_staff_verification: false,
          },
          include: {
            customer: { include: { children: true } },
            assigned_staff: { select: { id: true, name: true, phone: true } },
            children: true,
          },
        });

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

        // CAPI Purchase decoupled: event Purchase HANYA via Meta Purchase Queue (POST /api/admin/reservation/:id/approve-purchase)
        // ΓÇö Tandai Lunas / Confirm tidak lagi auto-trigger CAPI & tidak set purchase_event_sent_at.

        // Mandat Mutlak Anti-Label WAHA: pelunasan melepas label lifecycle via DB
        // internal (tabel CustomerLabel) ΓÇö zero mutasi label WAHA.
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

          // CAPI decoupled ΓÇö mock juga tidak kirim Purchase & tidak set purchase_event_sent_at.

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
          strict: false, // perilaku lama satuan: tanpa cek transisi
          forceComplete: (request.body as any)?.forceComplete,
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
          // NOT_FOUND ΓåÆ lempar agar jatuh ke fallback memori / 404 (perilaku lama).
          throw new Error('Reservation not found');
        }

        // MT-1.4: seam terpusat completed ΓÇö dekopling REVIEW/NEXT + reset V3 episodik
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
   *
   * Kontrak:
   *  - body `{ ids: string[] }` ΓÇö array 1..50 id (duplikat di-dedupe, whitespace di-trim);
   *  - tenant-scoped: id milik tenant lain ΓåÆ dilewati sebagai NOT_FOUND;
   *  - HANYA status confirmed/en_route yang boleh diselesaikan (keyat ketat, paritas
   *    `canTransition`); sisanya dilewati sebagai NOT_ELIGIBLE;
   *  - reservasi masa depan (> 24 jam, `isPrematureCompletion`) dilewati sebagai PREMATURE;
   *  - setiap sukses menjalankan efek samping lifecycle (follow-up/Sheets/reset sesi);
   *  - DB offline saat preflight ΓåÆ 503 eksplisit (batal total, bukan setengah jalan);
   *  - SATU audit `BULK_COMPLETE_RESERVATIONS` merangkum hasil.
   *
   * Respons: `{ success, completed: string[], skipped: [{ id, reason }], note? }`.
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
          outcome = await completeReservationById({ id, tenantId, strict: true, forceComplete: false });
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

  /**
   * PATCH /api/admin/reservation/:id
   * Edit lengkap rincian reservasi: data pasien, anak/bayi, jadwal, layanan, tarif, status, penugasan terapis, dll.
   */
  fastify.patch(
    '/api/admin/reservation/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          treatmentCategory?: 'BABY' | 'MOMS' | 'BOTH' | 'KIDS' | 'BUNDLE';
          treatmentDetail?: string;
          bookingDate?: string | null;
          assignedStaffId?: string | null;
          purchaseValue?: number;
          status?: 'pending' | 'hold' | 'confirmed' | 'completed' | 'cancelled';
          ongkir?: number | null;
          notes?: string;
          rawText?: string;
          paymentMethod?: 'CASH' | 'TRANSFER' | 'QRIS' | null;
          customerName?: string;
          customerPhone?: string;
          address?: string;
          kecamatan?: string;
          kota?: string;
          kelurahan?: string;
          customerAddressId?: string | null;
          customer_address_id?: string | null;
          durationMinutes?: number | null;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      // Dual-casing: lengkapi camelCase dari snake_case bila camel absen (kontrak toleran).
      // Tidak menimpa nilai camel yang sudah dikirim; "" tetap diteruskan apa adanya.
      const rawBody = (request.body || {}) as any;
      const body: any = { ...rawBody };
      const dualCaseMap: Record<string, string> = {
        treatment_category: 'treatmentCategory',
        treatment_detail: 'treatmentDetail',
        booking_date: 'bookingDate',
        assigned_staff_id: 'assignedStaffId',
        purchase_value: 'purchaseValue',
        duration_minutes: 'durationMinutes',
        payment_method: 'paymentMethod',
        customer_name: 'customerName',
        customer_phone: 'customerPhone',
        customer_address_id: 'customerAddressId',
      };
      for (const [snakeKey, camelKey] of Object.entries(dualCaseMap)) {
        if (body[camelKey] === undefined && body[snakeKey] !== undefined) body[camelKey] = body[snakeKey];
      }
      const {
        treatmentCategory,
        treatmentDetail,
        bookingDate,
        assignedStaffId,
        purchaseValue,
        status,
        notes,
        rawText,
        paymentMethod,
        customerName,
        customerPhone,
        address,
        kecamatan,
        kota,
        kelurahan,
        landmark,
        babies,
        durationMinutes: reqDurationMinutes,
      } = body;

      let existing: any = null;
      try {
        existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: { customer: { include: { children: true } }, customer_address: true },
        });
      } catch (dbErr: any) {
        console.warn(`[Admin API] DB query failed for reservation ${id}, checking in-memory store:`, dbErr.message);
      }

      const normalizeTreatmentCategory = (cat?: string): 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' | undefined => {
        if (!cat) return undefined;
        const upper = String(cat).toUpperCase();
        if (upper === 'BUNDLE' || upper === 'BOTH') return 'BOTH';
        if (upper === 'MOMS') return 'MOMS';
        if (upper === 'KIDS') return 'KIDS';
        if (upper === 'BABY') return 'BABY';
        return 'BABY';
      };
      const normalizedCat = treatmentCategory !== undefined ? normalizeTreatmentCategory(treatmentCategory) : undefined;

      if (!existing) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === tenantId) {
          const completionMockDate = bookingDate !== undefined
            ? (bookingDate ? new Date(bookingDate) : null)
            : mock.booking_date;
          if (
            status === 'completed' &&
            mock.status !== 'completed' &&
            isPrematureCompletion(completionMockDate) &&
            !(body as any)?.forceComplete
          ) {
            return reply.status(400).send({
              success: false,
              code: 'PREMATURE_COMPLETION_BLOCKED',
              error: 'Reservasi masa depan tidak dapat ditandai sebagai completed sebelum tanggal kunjungan tiba. Gunakan forceComplete: true bila ada persetujuan darurat.',
            });
          }
          if (normalizedCat !== undefined) mock.treatment_category = normalizedCat;
          if (treatmentDetail !== undefined) mock.treatment_detail = treatmentDetail;
          if (purchaseValue !== undefined) mock.purchase_value = purchaseValue;
          if (body.customerAddressId !== undefined || body.customer_address_id !== undefined) {
            const caId = body.customerAddressId !== undefined ? body.customerAddressId : body.customer_address_id;
            mock.customer_address_id = caId || null;
          }
          if (status !== undefined) mock.status = status;
          if (notes !== undefined) {
            mock.notes = notes;
            const fallbackTitle = `[Admin Manual] ${normalizedCat || mock.treatment_category}: ${treatmentDetail || mock.treatment_detail || ''}`;
            mock.raw_text = mergeNotesIntoRawText(mock.raw_text, notes, fallbackTitle);
          }
          if (rawText !== undefined) mock.raw_text = rawText;
          if (paymentMethod !== undefined) mock.payment_method = paymentMethod;
          if (assignedStaffId !== undefined) {
            const staffId = (assignedStaffId as string) || null;
            mock.assigned_staff_id = staffId;
            // Paritas relasi DB di mode memory: lookup staff nyata (tanpa hardcode nama).
            // Bila lookup gagal (DB offline), relasi null ΓÇö UI fallback ke staffList via FK.
            let staffObj: { id: string; name: string; phone?: string } | null = null;
            if (staffId) {
              try {
                const staff = await prisma.staff.findFirst({
                  where: { id: staffId, tenant_id: tenantId },
                  select: { id: true, name: true },
                });
                staffObj = staff ? { id: staff.id, name: staff.name } : null;
              } catch {
                staffObj = null;
              }
            }
            mock.assigned_staff = staffObj;
          }
          if (bookingDate !== undefined) mock.booking_date = bookingDate ? new Date(bookingDate) : null;
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({
            success: true,
            data: {
              ...mock,
              notes: mock.notes || extractNotesFromRawText(mock.raw_text),
            },
            note: 'Fallback in-memory mode',
          });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }

      try {
        // Validasi FK staff tenant-scoped (paritas jalur /assign-staff) bila penugasan diisi.
        if (assignedStaffId) {
          const staffExists = await prisma.staff.findFirst({
            where: { id: assignedStaffId, tenant_id: tenantId },
            select: { id: true },
          });
          if (!staffExists) {
            return reply.status(400).send({ success: false, error: 'Staff yang dipilih tidak valid.' });
          }
        }
        const isBecomingConfirmed = status === 'confirmed' && existing.status !== 'confirmed';
        const isBecomingCancelled = status === 'cancelled' && existing.status !== 'cancelled';
        const isBecomingCompleted = status === 'completed' && existing.status !== 'completed';
        const staffChanged = assignedStaffId !== undefined && assignedStaffId !== existing.assigned_staff_id;

        const updateData: any = {};
        if (normalizedCat !== undefined) updateData.treatment_category = normalizedCat;
        if (treatmentDetail !== undefined) updateData.treatment_detail = treatmentDetail;
        if (purchaseValue !== undefined) updateData.purchase_value = purchaseValue;
        if (status !== undefined) updateData.status = status;
        if (body.customerAddressId !== undefined || body.customer_address_id !== undefined) {
          const caId = body.customerAddressId !== undefined ? body.customerAddressId : body.customer_address_id;
          updateData.customer_address_id = caId || null;
        }
        
        // Handle notes via raw_text: TIDAK menugaskan updateData.notes karena model Reservation tidak punya kolom notes di Prisma
        if (rawText !== undefined) {
          updateData.raw_text = rawText;
        } else if (notes !== undefined) {
          const fallbackTitle = `[Admin Manual] ${treatmentCategory || existing.treatment_category}: ${treatmentDetail || existing.treatment_detail || ''}`;
          updateData.raw_text = mergeNotesIntoRawText(existing.raw_text, notes, fallbackTitle);
        }
        if (paymentMethod !== undefined) updateData.payment_method = paymentMethod;
        if (reqDurationMinutes !== undefined) {
          if (reqDurationMinutes === null || (reqDurationMinutes as unknown) === '') {
            updateData.duration_minutes = null;
          } else {
            const d = sanitizeDurationMinutes(reqDurationMinutes);
            if (d !== null) updateData.duration_minutes = d;
          }
        }

        if (assignedStaffId !== undefined) {
          updateData.assigned_staff_id = assignedStaffId || null;
        }

        // Fondasional: jika ongkir dikirim saat edit, sinkronkan ke Customer.ongkir
        if ((body as any).ongkir !== undefined && (body as any).ongkir !== null && existing.customer_id) {
          try {
            await prisma.customer.update({
              where: { id: existing.customer_id, tenant_id: tenantId },
              data: { ongkir: Number((body as any).ongkir) },
            });
          } catch (e) {
            console.warn('[Admin API] Failed to update Customer.ongkir on edit:', (e as Error).message);
          }
        }

        let parsedBookingDate: Date | null | undefined = undefined;
        if (bookingDate !== undefined) {
          if (bookingDate === null || bookingDate === '') {
            updateData.booking_date = null;
            parsedBookingDate = null;
          } else {
            const d = new Date(bookingDate);
            if (!isNaN(d.getTime())) {
              updateData.booking_date = d;
              parsedBookingDate = d;
            }
          }
        }

        // Pengecekan bentrok staf pada edit jadwal / reassign (kecuali force: true)
        const targetDate = parsedBookingDate !== undefined ? parsedBookingDate : existing.booking_date;
        const targetStaff = assignedStaffId !== undefined ? (assignedStaffId || null) : existing.assigned_staff_id;
        const targetDur = updateData.duration_minutes ?? existing.duration_minutes ?? 60;
        const isForce = Boolean((body as any).force);
        const isActiveStatus = (updateData.status || existing.status) !== 'cancelled';

        if (targetStaff && targetDate && isActiveStatus && !isForce && (staffChanged || parsedBookingDate !== undefined)) {
          const { findOverlappingStaffReservations } = await import('../../services/reservation-core.service');
          const staffConflicts = await findOverlappingStaffReservations({
            tenantId,
            staffId: targetStaff,
            bookingDate: targetDate,
            durationMinutes: targetDur,
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

        // Guard anti-completed prematur (edit penuh): tolak menandai selesai
        // jadwal > 24 jam ke depan sebelum tanggal kunjungan tiba.
        const completionTargetDate = parsedBookingDate !== undefined ? parsedBookingDate : existing.booking_date;
        if (isBecomingCompleted && isPrematureCompletion(completionTargetDate) && !(body as any)?.forceComplete) {
          return reply.status(400).send({
            success: false,
            code: 'PREMATURE_COMPLETION_BLOCKED',
            error: 'Reservasi masa depan tidak dapat ditandai sebagai completed sebelum tanggal kunjungan tiba. Gunakan forceComplete: true bila ada persetujuan darurat.',
          });
        }

        const updated = await prisma.reservation.update({
          where: { id },
          data: updateData,
          include: {
            customer: {
              include: {
                children: true,
              },
            },
            customer_address: true,
            assigned_staff: true,
          },
        });

        // ΓöÇΓöÇ Side-effects: transisi status confirmed/cancelled & penugasan staff ΓöÇΓöÇ
        if (isBecomingConfirmed) {
          const targetBookingDate = parsedBookingDate || existing.booking_date;
          if (targetBookingDate) {
            try {
              const { followUpService } = await import('../../services/follow-up.service');
              await followUpService.createReservationFollowUps({
                reservationId: id,
                customerId: existing.customer_id,
                bookingDate: targetBookingDate,
                treatmentCategory: updated.treatment_category,
                tenantId: tenantId,
              });
            } catch (fuErr: any) {
              console.warn('[Admin API] Failed to schedule follow-ups on becoming confirmed:', fuErr.message);
            }
          }
          if (!updated.google_calendar_event_id && (parsedBookingDate || existing.booking_date)) {
            try {
              const cName = customerName || existing.customer?.name || 'Bunda';
              const calEventId = await googleCalendarService.createEvent(updated, cName);
              if (calEventId) {
                await prisma.reservation.update({ where: { id }, data: { google_calendar_event_id: calEventId } });
                (updated as any).google_calendar_event_id = calEventId;
              }
            } catch (gcErr: any) {
              console.error('[Admin API] Google Calendar Event create on edit failed:', gcErr.message);
            }
          }
          // CAPI Purchase decoupled: tidak auto-kirim saat edit menjadi confirmed ΓÇö eksklusif via Purchase Queue.
        }
        if (isBecomingCompleted) {
          const targetBookingDate = parsedBookingDate || existing.booking_date;
          if (targetBookingDate) {
            try {
              const { reservationLifecycleService } = await import('../../services/reservation-lifecycle.service');
              await reservationLifecycleService.onReservationCompleted({
                customerId: existing.customer_id,
                reservationId: id,
                bookingDate: targetBookingDate,
                treatmentCategory: updated.treatment_category,
                tenantId: existing.tenant_id || tenantId,
              });
            } catch (fuErr: any) {
              console.warn('[Admin API] Failed to sync follow-ups on becoming completed:', fuErr.message);
            }
          }
        }
        if (isBecomingCancelled) {
          try {
            const { followUpService } = await import('../../services/follow-up.service');
            await followUpService.onReservationCancelled(id, existing.tenant_id || tenantId);
          } catch (fuErr: any) {
            console.warn('[Admin API] Failed to cancel follow-ups on becoming cancelled:', fuErr.message);
          }
          if (existing.assigned_staff_id) {
            const cancelReason = (body as any)?.cancelReason || (body as any)?.reason || (body as any)?.cancel_reason || undefined;
            import('../../services/staff-notification.service').then(({ staffNotificationService }) => {
              staffNotificationService.sendReservationCancelledNotification(id, existing.assigned_staff_id!, cancelReason).catch((e: any) =>
                console.warn('[Admin API] Failed to send Telegram cancelled notification (edit):', e.message)
              );
            }).catch(() => {});
          }
          if (updated.google_calendar_event_id) {
            try {
              await googleCalendarService.deleteEvent(updated.google_calendar_event_id);
              await prisma.reservation.update({ where: { id }, data: { google_calendar_event_id: null } }).catch(() => {});
            } catch (gcErr: any) {
              console.warn('[Admin API] Google Calendar delete on cancel failed:', gcErr.message);
            }
          }
        }
        if (staffChanged && assignedStaffId) {
          try {
            const { staffNotificationService } = await import('../../services/staff-notification.service');
            // Buffer 5 menit: jadwalkan ulang (menimpa pending lama) ΓÇö terapis baru
            // baru menerima Telegram setelah jendela, agar koreksi admin tidak bocor.
            staffNotificationService.scheduleReservationAssignmentNotification(id, assignedStaffId).catch((err: any) => {
              console.error('[Admin API] Failed to schedule staff notification on edit:', err.message);
            });
            if (existing.assigned_staff_id && existing.assigned_staff_id !== assignedStaffId) {
              const newStaffName = (updated as any)?.assigned_staff?.name || undefined;
              // State-gate: staf lama hanya dinotifikasi bila penugasan sebelumnya
              // BENAR-BENAR sudah terkirim (bukan masih dalam buffer pending).
              const oldStaffWasNotified = (existing as any).assignment_notified_at != null;
              staffNotificationService.sendTaskUnassignedNotification(id, existing.assigned_staff_id, newStaffName, oldStaffWasNotified).catch((err: any) => {
                console.warn('[Admin API] Failed to send unassigned notification to old staff:', err.message);
              });
            }
          } catch (err: any) {
            console.warn('[Admin API] staffNotification import failed:', err.message);
          }
        }

        // Sync customer details if provided
        // Fondasional: Customer TIDAK punya kolom `address`; alamat lengkap disimpan di preferences.address (+ kelurahan bila kosong)
        if (existing.customer_id && (customerName || customerPhone || address || kecamatan || kota || kelurahan || landmark)) {
          const custUpdate: any = {};
          if (customerName) custUpdate.name = customerName;
          if (customerPhone) custUpdate.phone = customerPhone.replace(/\D/g, '');
          if (kecamatan) custUpdate.kecamatan = kecamatan;
          if (kota) custUpdate.kota = kota;
          if (kelurahan) custUpdate.kelurahan = kelurahan;
          if (address || landmark) {
            const currentPrefs = (existing.customer?.preferences as any) || {};
            const nextPrefs: any = { ...currentPrefs };
            if (address) nextPrefs.address = address;
            if (landmark) nextPrefs.landmark = landmark;
            custUpdate.preferences = nextPrefs;
            // Proteksi Integritas Spasial: alamat jalan fisik DILARANG disalin ke
            // kolom kelurahan (sumber pencemaran "Jl. Griya...(https://maps...)").
            // Kolom kelurahan hanya diisi entitas desa/kelurahan resmi dari
            // geocoding/gazetteer; alamat jalan hidup di preferences.address.
          }
          // assigned_staff_id: string kosong ΓåÆ null agar tidak menabrak FK
          // (ditangani di updateData.assigned_staff_id di atas; blok ini hanya customer)
          await prisma.customer.update({
            where: { id: existing.customer_id, tenant_id: tenantId },
            data: custUpdate,
          });
        }

        // Sync babies if provided
        if (existing.customer_id && Array.isArray(babies) && babies.length > 0) {
          const { parseAgeTextToBirthDate, monthsBetween } = await import('../../utils/age-calculator');
          for (const b of babies) {
            if (!b.name) continue;
            // Koreksi admin umur WAJIB menghitung ulang birth_date (bukan hanya
            // raw_age_text) ΓÇö jika tidak, anak lama yang sudah punya birth_date
            // tetap menampilkan umur lama (tampilan memprioritaskan birth_date).
            const newBirthDate = b.ageText ? parseAgeTextToBirthDate(b.ageText, new Date()) : null;
            const existingChild = existing.customer?.children?.find((c: any) => c.name.toLowerCase() === b.name.toLowerCase());
            if (existingChild) {
              const updateData: any = { raw_age_text: b.ageText || existingChild.raw_age_text };
              if (newBirthDate) {
                updateData.birth_date = newBirthDate;
                updateData.age_months_at_registration = monthsBetween(newBirthDate, new Date());
              }
              await prisma.child.update({ where: { id: existingChild.id }, data: updateData });
            } else {
              await prisma.child.create({
                data: {
                  tenant_id: tenantId,
                  customer_id: existing.customer_id,
                  name: b.name,
                  raw_age_text: b.ageText || '',
                  birth_date: newBirthDate,
                  age_months_at_registration: newBirthDate ? monthsBetween(newBirthDate, new Date()) : null,
                },
              });
            }
          }
        }

        // Google Calendar sync
        if (updated.google_calendar_event_id && parsedBookingDate) {
          try {
            const cName = customerName || existing.customer?.name || 'Bunda';
            await googleCalendarService.updateEvent(updated.google_calendar_event_id, updated, cName);
          } catch (gcErr) {
            console.error('[Admin API] Google Calendar Event update failed:', gcErr);
          }
        }

        // Reschedule follow-ups if date changed
        if (parsedBookingDate) {
          try {
            const { followUpService } = await import('../../services/follow-up.service');
            await followUpService.onReservationRescheduled(id, parsedBookingDate, existing.tenant_id || tenantId);
          } catch (fuErr: any) {
            console.warn('[Admin API] Failed to reschedule follow-ups on reservation edit:', fuErr.message);
          }
        }

        // Cermin Sheets: update baris yang sama (bayar/bidan/status/treatment) HANYA bila completed.
        // Fire-and-forget; kolom harga H/I/J/K write-once tidak tersentuh.
        if ((updated?.status || existing?.status) === 'completed') {
          import('../../services/sheets/sheets-sync.service')
            .then(({ sheetsSyncService }) => sheetsSyncService.enqueue(id, existing.tenant_id || tenantId))
            .catch((err) => console.warn('[Admin API] sheets enqueue on edit failed:', err?.message));
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_RESERVATION_DETAIL',
          targetId: id,
          payload: body,
          ipAddress: request.ip,
        });

        // Phase 4: Sync ltv_cache when purchase_value or status changes
        if (purchaseValue !== undefined || status !== undefined) {
          try {
            const { customerService } = await import('../../services/customer.service');
            await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId);
          } catch (ltvErr: any) {
            console.warn('[Admin API] Failed to recalculate ltv_cache on reservation edit:', ltvErr.message);
          }
        }

        // Hydrated relation parity: re-fetch with customer.children + assigned_staff
        let reservationResponse: any = {
          ...updated,
          notes: extractNotesFromRawText(updated.raw_text),
        };
        try {
          const full = await prisma.reservation.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
              customer: { include: { children: true } },
              assigned_staff: { select: { id: true, name: true, phone: true } },
            },
          });
          if (full) {
            reservationResponse = {
              ...full,
              notes: extractNotesFromRawText(full.raw_text),
            };
          } else {
            // Fallback R7: re-fetch gagal ΓåÆ tempel existing.customer (sudah include children dari line 1408)
            if (existing?.customer) {
              reservationResponse = {
                ...reservationResponse,
                customer: existing.customer,
              };
            }
          }
        } catch (err: any) {
          console.warn('[Admin API] Failed to re-fetch full relations on reservation patch:', err.message);
          // Fallback R7: re-fetch gagal ΓåÆ tempel existing.customer (sudah include children dari line 1408)
          if (existing?.customer) {
            reservationResponse = {
              ...reservationResponse,
              customer: existing.customer,
            };
          }
        }

        return reply.status(200).send({
          success: true,
          data: reservationResponse,
        });
      } catch (error: any) {
        console.error(`[Admin API] Failed to update reservation ${id}:`, error);
        return reply.status(500).send({
          success: false,
          error: error?.message || 'Gagal memperbarui reservasi',
        });
      }
    }
  );

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

        const { canTransition: canT2, isHoldActive: isHA2, isHoldActiveByCreated: isHAC2 } = await import('../../domain/reservation-status');
        if (!canT2(existing.status, status)) {
          return reply.status(409).send({ success: false, code: 'ILLEGAL_TRANSITION', error: `Transisi ${existing.status} ΓåÆ ${status} ditolak.` });
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

        // Fase 3.2: reaktivasi (cancelled/hold ΓåÆ confirmed) WAJIB dicek bentrok
        // terapis. Tanpa ini, terapis bisa double-booked tanpa terdeteksi.
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

        // Revisi-1 (Opsi B): "selesai" TIDAK menyiratkan "lunas". Fallback
        // pengisian purchase_occurred_at di sini DIHAPUS agar konsisten dengan
        // `completeReservationById` (seam tunggal). Lunas HANYA via recordPayment
        // (staff), approve-purchase, atau deteksi pesan Payment.
        const updateStatusData: any = { status };

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

        // Phase 4: Sync ltv_cache when status changes to/from cancelled
        if (status === 'cancelled' || existing.status === 'cancelled') {
          try {
            const { customerService } = await import('../../services/customer.service');
            await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId);
          } catch (ltvErr: any) {
            console.warn('[Admin API] Failed to recalculate ltv_cache on status change:', ltvErr.message);
          }
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

  /**
   * PUT /api/admin/reservation/:id/proof
   * Upload / hapus bukti bayar dari modal Manage reservasi.
   * Gambar dikompres max 800px (sharp) lalu disimpan sebagai media outbound
   * tenant (inline MQL & retensi media). remove=true menghapus proof_url.
   */
  fastify.put(
    '/api/admin/reservation/:id/proof',
    { bodyLimit: 12 * 1024 * 1024 },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { imageB64?: string; mimeType?: string; fileName?: string; remove?: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      const { imageB64, mimeType, fileName, remove } = request.body || {};

      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        let proofUrl: string | null = null;
        if (!remove && imageB64) {
          const { mediaService } = await import('../../services/media.service');
          const rawB64 = imageB64.replace(/^data:image\/[^;]+;base64,/, '');
          const resized = await mediaService.resizeImageToMax(Buffer.from(rawB64, 'base64'), 800);
          const saved = await mediaService.saveOutboundMedia({
            tenantId: tenantId,
            imageB64: resized.toString('base64'),
            mimeType: mimeType && mimeType !== 'application/octet-stream' ? mimeType : 'image/jpeg',
            fileName: fileName || `proof-${id}.jpg`,
          });
          proofUrl = saved.hdUrl;
        }

        const updated = await prisma.reservation.update({
          where: { id },
          data: { proof_url: proofUrl },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: remove ? 'ADMIN_REMOVE_PROOF' : 'ADMIN_UPLOAD_PROOF',
          targetId: id,
          payload: remove ? { removed: true } : { proofUrl },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: updated });
      } catch (error) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === tenantId) {
          mock.proof_url = remove ? null : mock.proof_url;
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
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

        if (assigned_staff_id) {
          const { staffNotificationService } = await import('../../services/staff-notification.service');
          staffNotificationService.scheduleReservationAssignmentNotification(id, assigned_staff_id).catch((err) => {
            console.error('[Admin API] Failed to schedule staff notification on assign:', err.message);
          });
        }

        // Cermin Sheets: update kolom Bidan di baris yang sama HANYA bila status completed.
        // Fire-and-forget; harga write-once tidak tersentuh (lihat sheets-sync).
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

  /**
   * DELETE /api/admin/reservation/:id
   * Mendukung soft-cancel (default) atau hard delete permanen (?hard=true)
   */
  fastify.delete(
    '/api/admin/reservation/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { hard?: string };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      const isHardDelete = request.query?.hard === 'true';
      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: { customer: true },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        if (existing.google_calendar_event_id) {
          try {
            await googleCalendarService.deleteEvent(existing.google_calendar_event_id);
          } catch (err) {
            console.error('[Admin API] Google Calendar Event deletion failed:', err);
          }
        }

        if (isHardDelete) {
          // Audit P1-14: batalkan follow-up pengingat/review terkait SEBELUM
          // reservasi dihapus (relasi onDelete:SetNull akan men-null-kan
          // reservation_id sehingga tidak bisa lagi dicocokkan setelah delete).
          try {
            const { followUpService } = await import('../../services/follow-up.service');
            await followUpService.onReservationCancelled(id, existing.tenant_id || tenantId);
          } catch (_) {}

          // Unlink child relation jika ada
          await prisma.child.updateMany({
            where: { reservation_id: id },
            data: { reservation_id: null },
          }).catch(() => {});

          // FIX 173i-d: notifikasi staf WAJIB dikirim SEBELUM reservasi dihapus,
          // karena service memuat reservasi dari DB (setelah delete ΓåÆ "not found"
          // ΓåÆ notifikasi hilang senyap). Await agar urutan deterministik.
          if (existing.assigned_staff_id) {
            try {
              const { staffNotificationService } = await import('../../services/staff-notification.service');
              await staffNotificationService.sendReservationCancelledNotification(
                id,
                existing.assigned_staff_id,
                (request.query as any)?.reason || undefined
              );
            } catch (e: any) {
              console.warn('[Admin API] Failed to send cancelled notification (hard delete):', e.message);
            }
          }

          await prisma.reservation.delete({
            where: { id },
          });

          await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId).catch(() => {});

          await auditService.logAdminAction({
            apiKey: (request as any).adminKeyUsed,
            adminIdentity: (request as any).adminIdentity,
            action: 'DELETE_RESERVATION_PERMANENT',
            targetId: id,
            payload: { hard: true },
            ipAddress: request.ip,
          });

          return reply.status(200).send({ success: true, message: 'Reservasi berhasil dihapus permanen.' });
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: { status: 'cancelled' },
        });

        // Audit P1-14: batalkan follow-up pengingat H-1 / review H+1 terkait
        // reservasi yang dibatalkan (sebelumnya hanya membuat NO_PURCHASE baru).
        try {
          const { followUpService } = await import('../../services/follow-up.service');
          await followUpService.onReservationCancelled(id, existing.tenant_id || tenantId);
        } catch (_) {}

        if (existing.assigned_staff_id) {
          const cancelReason = (request.query as any)?.reason || undefined;
          import('../../services/staff-notification.service').then(({ staffNotificationService }) => {
            staffNotificationService.sendReservationCancelledNotification(id, existing.assigned_staff_id!, cancelReason).catch((e: any) =>
              console.warn('[Admin API] Failed to send Telegram cancelled (soft delete):', e.message)
            );
          }).catch(() => {});
        }

        await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId).catch(() => {});

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
      } catch (error) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === tenantId) {
          if (isHardDelete) {
            memoryReservations.delete(id);
            await customerService.recalculateCustomerLtv(mock.customer_id, tenantId).catch(() => {});
            return reply.status(200).send({ success: true, message: 'Reservasi berhasil dihapus permanen (memory).' });
          }
          mock.status = 'cancelled';
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          await customerService.recalculateCustomerLtv(mock.customer_id, tenantId).catch(() => {});
          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );

  /**
   * POST /api/admin/reservation/:id/approve-purchase
   * Moderasi outlier: admin menyetujui event Purchase yang ditahan queue
   * (purchase_review_status='pending'). Event dikirim ke Meta CAPI dengan
   * event_time HISTORIS (purchase_occurred_at) agar attribution akurat.
   * Event >7 hari ditolak ΓÇö Meta akan drop event yang terlalu lama.
  /**
   * POST /api/admin/reservation/:id/approve-purchase
   * Moderasi outlier: admin menyetujui event Purchase yang ditahan queue
   * (purchase_review_status='pending'). Event dikirim ke Meta CAPI dengan
   * event_time HISTORIS (purchase_occurred_at) agar attribution akurat.
   * Event >7 hari ditolak ΓÇö Meta akan drop event yang terlalu lama.
   */
  fastify.post(
    '/api/admin/reservation/:id/approve-purchase',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      try {
        if (id.startsWith('lead_')) {
          const customerId = id.replace('lead_', '');
          const customer = await prisma.customer.findFirst({
            where: { id: customerId, tenant_id: tenantId },
            include: { adClick: true },
          });
          if (!customer) {
            return reply.status(404).send({ success: false, error: 'Customer not found' });
          }
          const occurredDate = customer.mql_triggered_at || customer.created_at || new Date();
          const occurredAt = new Date(occurredDate);

          const leadCapiResult = await capiService.sendCapiEvent({
            eventName: 'Lead',
            customer,
            adClick: customer.adClick || undefined,
            tenantId: tenantId,
            eventTime: Math.floor(occurredAt.getTime() / 1000),
            customData: {
              source: 'ADMIN_MODERATION_APPROVE_LEAD',
              mql_bubble_count: customer.mql_bubble_count || 5,
            },
          });

          if (!leadCapiResult.success) {
            console.error(`[CAPI ERROR] Approved Lead send failed for ${id}: ${leadCapiResult.message}`);
            return reply.status(502).send({
              success: false,
              error: `Meta CAPI menolak Lead event: ${leadCapiResult.message || 'unknown error'}`,
              metaResponse: leadCapiResult.metaResponse,
            });
          }

          await auditService.logAdminAction({
            apiKey: (request as any).adminKeyUsed,
            adminIdentity: (request as any).adminIdentity,
            action: 'MQL_LEAD_EVENT_SENT',
            targetId: customerId,
            payload: { mql_triggered_at: occurredAt.toISOString() },
            ipAddress: request.ip,
          });

          return reply.status(200).send({ success: true, message: 'Lead event disetujui & dikirim ke Meta CAPI' });
        }

        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: {
            customer: {
              include: { adClick: true },
            },
          },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        // Izinkan re-send jika force=true, bahkan jika status sudah approved
        const forceResend = (request.body as any)?.force === true;
        const forceReason = typeof (request.body as any)?.reason === 'string' ? (request.body as any).reason.trim() : '';
        const allowAged = (request.body as any)?.allowAged === true;

        if (existing.purchase_event_sent_at != null && !forceResend) {
          return reply.status(400).send({
            success: false,
            error: `Event Purchase untuk reservasi ini sudah pernah terkirim ke Meta CAPI pada ${existing.purchase_event_sent_at.toISOString()}. Gunakan force: true beserta alasan (reason) untuk mengirim ulang.`,
          });
        }

        if (existing.purchase_review_status !== 'pending' && !forceResend) {
          return reply.status(400).send({
            success: false,
            error: `Purchase event sudah diproses (status: ${existing.purchase_review_status}). Gunakan force: true beserta alasan (reason) untuk mengirim ulang.`,
          });
        }

        if (forceResend && forceReason.length < 5) {
          return reply.status(400).send({
            success: false,
            error: `Pengiriman ulang (force: true) wajib menyertakan alasan minimal 5 karakter pada field reason.`,
          });
        }

        const occurredDate = existing.purchase_occurred_at || existing.created_at || new Date();
        const occurredAt = new Date(occurredDate);
        const daysOld = Math.floor((Date.now() - occurredAt.getTime()) / (24 * 60 * 60 * 1000));
        let warning: string | undefined;
        if (daysOld > 7 && !allowAged) {
          return reply.status(400).send({
            success: false,
            error: `Event terjadi ${daysOld} hari lalu (>7 hari). Meta CAPI menolak event berumur lebih dari 7 hari karena akan merusak akurasi atribusi. Gunakan allowAged: true jika Anda yakin ingin tetap mengirimkannya.`,
          });
        }
        if (daysOld > 7) {
          warning = `Event terjadi ${daysOld} hari lalu (>7 hari) dan dikirim dengan allowAged: true. Meta CAPI kemungkinan akan mengabaikan event ini.`;
        }

        const body = (request.body || {}) as { customPayload?: any; reason?: string; force?: boolean; allowAged?: boolean };
        const customPayload = body.customPayload;

        const formats = await getTenantCapiFormats(tenantId);
        
        let autoResolvedVal = existing.purchase_value && existing.purchase_value > 0 ? existing.purchase_value : undefined;
        if (!autoResolvedVal) {
          const raw = existing.raw_text || '';
          if (raw && /payment|pembayaran|total\s*[:=]|treatment\s*[:=]/i.test(raw)) {
            try {
              const fin = parsePaymentSection(raw);
              if (fin.treatmentPrice > 0) autoResolvedVal = fin.treatmentPrice;
              else if (fin.totalPrice > 0) autoResolvedVal = Math.max(0, fin.totalPrice - fin.ongkir + fin.promo);
            } catch {}
          }
          if (!autoResolvedVal) {
            autoResolvedVal =
              extractValueByFormat(raw, formats.formatValue) ??
              extractRupiahAmount(raw, formats.formatValue) ??
              (await resolveTreatmentValue(existing.treatment_detail || raw, tenantId));
          }
        }

        const customValueProvided = typeof customPayload?.custom_data?.value === 'number';
        const resolvedVal = customValueProvided
          ? customPayload.custom_data.value
          : autoResolvedVal;

        if (resolvedVal == null || resolvedVal <= 0) {
          return reply.status(400).send({
            success: false,
            error: `Nilai transaksi tidak terdeteksi dari data reservasi (nilai: ${resolvedVal ?? 'null'}). Harap tentukan nilai transaksi secara manual melalui form edit atau customPayload.custom_data.value.`,
          });
        }

        const eventName = (customPayload && typeof customPayload.event_name === 'string')
          ? customPayload.event_name
          : 'Purchase';

        const eventTime = (customPayload && typeof customPayload.event_time === 'number')
          ? customPayload.event_time
          : Math.floor(occurredAt.getTime() / 1000);

        const customData = customPayload?.custom_data
          ? {
              ...customPayload.custom_data,
              source: 'ADMIN_MODERATION_APPROVE_CUSTOM',
              reservationId: existing.id,
              purchaseOccurredAt: occurredAt.toISOString(),
            }
          : {
              source: 'ADMIN_MODERATION_APPROVE',
              reservationId: existing.id,
              purchaseOccurredAt: occurredAt.toISOString(),
            };

        // Jika nama customer masih generic (misal "Mbak" / "Bunda"), update nama customer di DB dari raw_text
        if (existing.raw_text && existing.customer) {
          try {
            const { parseReservationText } = await import('../../utils/reservation-text-parser');
            const pr = parseReservationText(existing.raw_text);
            if (pr.success && pr.reservation?.name) {
              const cleanName = pr.reservation.name.replace(/^(?:bunda|ibu|mama|mom|mbak|mas|kak|kakak|ny|ny\.)\s+/i, '').trim();
              if (cleanName && !['bunda', 'ibu', 'mama', 'mom', 'mbak', 'mas', 'kak', 'kakak', 'pasien', 'customer', '-'].includes(cleanName.toLowerCase())) {
                const formattedName = `Bunda ${cleanName}`.trim();
                const { customerService } = await import('../../services/customer.service');
                await customerService.updateCustomerName(existing.customer.id, formattedName, tenantId).catch(() => {});
                existing.customer.name = formattedName;
              }
            }
          } catch {}
        }

        // 5. AWAIT CAPI ΓÇö hanya set approved jika Meta benar-benar menerima event.
        const capiResult = await capiService.sendCapiEvent({
          eventName,
          customer: existing.customer,
          adClick: existing.customer?.adClick || undefined,
          value: resolvedVal,
          currency: customPayload?.custom_data?.currency || 'IDR',
          tenantId: tenantId,
          eventTime,
          customData,
          customUserData: customPayload?.user_data,
          customEventId: customPayload?.event_id,
          reservationId: existing.id,
        });

        if (!capiResult.success) {
          console.error(`[CAPI ERROR] Approved Purchase send failed for ${id}: ${capiResult.message}`);
          return reply.status(502).send({
            success: false,
            error: `Meta CAPI menolak event: ${capiResult.message || 'unknown error'}`,
            metaResponse: capiResult.metaResponse,
          });
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: {
            purchase_occurred_at: occurredDate,
            purchase_value: resolvedVal ?? undefined,
            purchase_review_status: 'approved',
            purchase_event_sent_at: new Date(),
          },
        });

        await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId).catch(() => {});

        // Fase 4.3: Otomatis batalkan follow-up NO_PURCHASE yang masih PENDING/QUEUED
        // karena customer sudah terbukti purchase / closing
        try {
          await prisma.followUp.updateMany({
            where: {
              customer_id: existing.customer_id,
              tenant_id: existing.tenant_id || tenantId,
              status: { in: ['PENDING', 'QUEUED'] },
              type: 'NO_PURCHASE',
            },
            data: {
              status: 'CANCELLED',
              cancel_reason: 'Transaksi pembelian disetujui (Purchase Approved)',
            },
          });
        } catch (fuErr: any) {
          console.warn('[CAPI APPROVE] Failed to cancel pending follow-ups:', fuErr.message);
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'APPROVE_PURCHASE_EVENT',
          targetId: id,
          payload: {
            purchase_occurred_at: occurredAt.toISOString(),
            value: resolvedVal,
            force: forceResend || undefined,
            forceReason: forceResend ? forceReason : undefined,
            allowAged: allowAged || undefined,
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: reservation, warning });
      } catch (error) {
        console.error('[CAPI APPROVE ERROR]', (error as Error).message);
        // Fallback in-memory hanya untuk dev/test ΓÇö di production harus fail agar UI tidak tampil success palsu
        if (process.env.NODE_ENV !== 'production') {
          const mock = memoryReservations.get(id);
          if (mock && mock.tenant_id === tenantId) {
            mock.purchase_review_status = 'approved';
            mock.purchase_event_sent_at = new Date();
            mock.updated_at = new Date();
            memoryReservations.set(id, mock);
            return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
          }
        }
        const msg = (error as Error).message || 'Reservation not found';
        const status = msg.includes('not found') || msg.includes('Not found') ? 404 : 500;
        return reply.status(status).send({ success: false, error: msg });
      }
    }
  );

  /**
    * POST /api/admin/reservation/:id/reject-purchase
   * Moderasi outlier: admin menandai transaksi sebagai outlier / dibatalkan
   * (purchase_review_status='ignored_outlier'). Event TIDAK dikirim ke Meta CAPI
   * agar tidak mencemari data optimasi Ads Manager.
   */
  fastify.post(
    '/api/admin/reservation/:id/reject-purchase',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      try {
        if (id.startsWith('lead_')) {
          const customerId = id.replace('lead_', '');
          await auditService.logAdminAction({
            apiKey: (request as any).adminKeyUsed,
            adminIdentity: (request as any).adminIdentity,
            action: 'MQL_LEAD_EVENT_REJECTED',
            targetId: customerId,
            payload: { reason: 'ADMIN_MANUAL_OUTLIER_REJECT' },
            ipAddress: request.ip,
          });

          return reply.status(200).send({ success: true, message: 'Lead event diabaikan' });
        }

        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: {
            customer: {
              include: { adClick: true },
            },
          },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }
        if (existing.purchase_review_status !== 'pending') {
          return reply.status(400).send({
            success: false,
            error: `Purchase event sudah diproses (status: ${existing.purchase_review_status}).`,
          });
        }

        // Moderasi CAPI murni urusan atribusi Meta Ads: HANYA mengubah
        // purchase_review_status. DILARANG menyentuh purchase_occurred_at /
        // purchase_value / payment_method ΓÇö status keuangan internal TIDAK
        // berubah. Melunasi reservasi tetap lewat jalur bayar resmi.
        const reservation = await prisma.reservation.update({
          where: { id },
          data: { purchase_review_status: 'ignored_outlier' },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'REJECT_PURCHASE_OUTLIER',
          targetId: id,
          payload: { reason: 'ADMIN_MANUAL_OUTLIER_REJECT' },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error) {
        console.error('[CAPI REJECT ERROR]', (error as Error).message);
        if (process.env.NODE_ENV !== 'production') {
          const mock = memoryReservations.get(id);
          if (mock && mock.tenant_id === tenantId) {
            mock.purchase_review_status = 'ignored_outlier';
            mock.updated_at = new Date();
            memoryReservations.set(id, mock);
            return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
          }
        }
        const msg = (error as Error).message || 'Reservation not found';
        const status = msg.includes('not found') || msg.includes('Not found') ? 404 : 500;
        return reply.status(status).send({ success: false, error: msg });
      }
    }
  );

  /**
   * POST /api/admin/reservation/:id/unreject-purchase
   * Fase 4.2: Memulihkan transaksi yang salah ditandai outlier kembali ke status pending
   * agar dapat dievaluasi atau disetujui ulang oleh admin.
   */
  fastify.post(
    '/api/admin/reservation/:id/unreject-purchase',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }
        if (existing.purchase_review_status !== 'ignored_outlier') {
          return reply.status(400).send({
            success: false,
            error: `Reservasi bukan berstatus outlier (status saat ini: ${existing.purchase_review_status}).`,
          });
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: { purchase_review_status: 'pending' },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UNREJECT_PURCHASE_OUTLIER',
          targetId: id,
          payload: { previous_status: 'ignored_outlier', new_status: 'pending' },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          data: reservation,
          message: 'Status moderasi berhasil dikembalikan ke pending',
        });
      } catch (error) {
        console.error('[CAPI UNREJECT ERROR]', (error as Error).message);
        if (process.env.NODE_ENV !== 'production') {
          const mock = memoryReservations.get(id);
          if (mock && mock.tenant_id === tenantId) {
            mock.purchase_review_status = 'pending';
            mock.updated_at = new Date();
            memoryReservations.set(id, mock);
            return reply.status(200).send({
              success: true,
              data: mock,
              message: 'Status moderasi berhasil dikembalikan ke pending (fallback memory)',
            });
          }
        }
        const msg = (error as Error).message || 'Reservation not found';
        const status = msg.includes('not found') || msg.includes('Not found') ? 404 : 500;
        return reply.status(status).send({ success: false, error: msg });
      }
    }
  );

  /**
    * GET /api/admin/capi-queue
   * Meja kerja Advertiser (Meta CAPI Queue): daftar reservasi & lead yang masuk ke sistem
   * beserta data atribusi (paid/organic + UTM) dan estimasi sisa usia event sebelum Meta drop (7 hari).
   */
  fastify.get('/api/admin/capi-queue', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = tenantOf(request);
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    reply.header('Pragma', 'no-cache');
    try {
      const query = (request.query || {}) as { status?: string; limit?: string };
      const statusFilter = query.status?.trim();
      const limitParam = parseInt(query.limit || '200', 10);
      const limit = Math.min(500, Math.max(10, Number.isFinite(limitParam) ? limitParam : 200));

      const whereClause: any = {
        tenant_id: tenantId,
        status: { not: 'cancelled' },
        customer: { is_sandbox_test: false },
        OR: [
          { purchase_occurred_at: { not: null } },
          { status: 'completed' },
        ],
      };

      if (statusFilter && statusFilter !== 'all') {
        if (statusFilter === 'pending') {
          whereClause.purchase_review_status = { in: ['pending'] };
        } else {
          whereClause.purchase_review_status = statusFilter;
        }
      }

      const rows = await prisma.reservation.findMany({
        where: whereClause,
        orderBy: { created_at: 'desc' },
        take: limit,
        include: {
          customer: {
            include: { adClick: true, children: true },
          },
        },
      });

      // Isolasi sandbox lapis presentasi (defense-in-depth): saring baris
      // sandbox/dummy yang lolos filter query (flag belum ter-set tapi nomor dummy).
      const visibleRows = rows.filter(
        (r: (typeof rows)[number]) => !shouldExcludeFromCapiQueue(r.customer?.phone, r.customer?.name, (r.customer as any)?.is_sandbox_test)
      );

      const formats = await getTenantCapiFormats(tenantId);
      const now = Date.now();

      let tenantLandingDomain = '';
      let wabaConfigured = false;
      try {
        // Select eksplisit: kolom tenants.settings belum ada di sebagian DB
        // (drift baseline, lihat docs/KNOWN_ISSUES.md #30) ΓÇö select-* memicu P2022.
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, landing_domain: true, waba_business_account_id: true },
        });
        if ((tenant as any)?.landing_domain) {
          tenantLandingDomain = (tenant as any).landing_domain.trim();
        }
        // State-gate UI preview: envelope business_messaging HANYA sah bila tenant
        // punya WABA id (paritas backend `capi.service.ts` useBusinessMessaging).
        wabaConfigured = Boolean((tenant as any)?.waba_business_account_id);
      } catch {}

      const treatmentPriceCache = new Map<string, number | undefined>();
      const getCachedTreatmentValue = async (detail: string): Promise<number | undefined> => {
        if (treatmentPriceCache.has(detail)) return treatmentPriceCache.get(detail);
        const v = await resolveTreatmentValue(detail, tenantId);
        treatmentPriceCache.set(detail, v);
        return v;
      };

      // Order number per customer (new vs repeat) ΓÇö 1 query, bukan N+1.
      // Basis kanonis: reservasi confirmed/completed (di luar cancelled/hold).
      // Ordinal ditetapkan dari urutan created_at per customer (deterministik).
      const customerIds = Array.from(new Set(visibleRows.map((r) => r.customer_id).filter(Boolean)));
      const orderNumberByReservation = new Map<string, number>();
      const totalConfirmedByCustomer = new Map<string, number>();
      if (customerIds.length > 0) {
        try {
          const confirmedRows = await prisma.reservation.findMany({
            where: {
              tenant_id: tenantId,
              customer_id: { in: customerIds },
              // Selaras dengan kanonis `computeIsRepeatOrder` (reservation-core):
              // status riwayat = confirmed/en_route/completed.
              status: { in: ['confirmed', 'en_route', 'completed'] },
            },
            select: { id: true, customer_id: true, created_at: true },
            orderBy: [{ customer_id: 'asc' }, { created_at: 'asc' }],
          });
          for (const row of confirmedRows as any[]) {
            const next = (totalConfirmedByCustomer.get(row.customer_id) ?? 0) + 1;
            totalConfirmedByCustomer.set(row.customer_id, next);
            orderNumberByReservation.set(row.id, next);
          }
        } catch {}
      }

      const reservationData = await Promise.all(
        visibleRows.map(async (r) => {
          const occurredDate = r.purchase_occurred_at || r.created_at || new Date();
          const occurredAt = new Date(occurredDate).getTime();
          const ageMs = Math.max(0, now - occurredAt);
          const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
          const daysOld = Math.floor(ageMs / (24 * 60 * 60 * 1000));
          const orderNumber = orderNumberByReservation.get(r.id) ?? 1;
          // Otoritas new-vs-repeat = ordinal riwayat transaksi nyata (orderNumber),
          // BUKAN flag `Reservation.is_repeat_order` yang bisa terkontaminasi
          // (mis. mutasi lama di follow-up.service). Order #1 SELALU 'new'.
          // Selaras dengan computeIsRepeatOrder (reservation-core) &
          // resolveNewVsRepeatContext (capi.service).
          const isRepeatOrder = orderNumber > 1;

          // Sanitize treatment_detail on the fly (hapus part yang berisi placeholder teks template)
          let sanitizedTreatmentDetail = r.treatment_detail || '';
          if (
            sanitizedTreatmentDetail.includes('Mohon bisa diisi') ||
            sanitizedTreatmentDetail.includes('bisa diisi Bunda') ||
            sanitizedTreatmentDetail.toLowerCase().includes('jika hamil') ||
            sanitizedTreatmentDetail.toLowerCase().includes('jika ada')
          ) {
            const parts = sanitizedTreatmentDetail.split('|').map(p => p.trim());
            const filtered = parts.filter(p => {
              const low = p.toLowerCase();
              return (
                !low.includes('mohon bisa diisi') &&
                !low.includes('bisa diisi bunda') &&
                !low.includes('jika hamil') &&
                !low.includes('jika ada')
              );
            });
            sanitizedTreatmentDetail = filtered.length > 0 ? filtered.join(' | ') : 'Treatment Homecare';
          }

          let calculatedValue = r.purchase_value && r.purchase_value > 0 ? r.purchase_value : undefined;
          if (!calculatedValue) {
            const raw = r.raw_text || '';
            if (raw && /payment|pembayaran|total\s*[:=]|treatment\s*[:=]/i.test(raw)) {
              try {
                const fin = parsePaymentSection(raw);
                if (fin.treatmentPrice > 0) calculatedValue = fin.treatmentPrice;
                else if (fin.totalPrice > 0) calculatedValue = Math.max(0, fin.totalPrice - fin.ongkir + fin.promo);
              } catch {}
            }
            if (!calculatedValue) {
              calculatedValue =
                extractValueByFormat(raw, formats.formatValue) ??
                extractRupiahAmount(raw, formats.formatValue) ??
                (await getCachedTreatmentValue(sanitizedTreatmentDetail || raw));
            }
          }

          const value = calculatedValue ?? 0;

          let distanceKm = r.customer?.distance_km ? `${r.customer.distance_km} km` : null;
          if (!distanceKm && r.raw_text) {
            const m = r.raw_text.match(/ongkir\s*([\d.,]+)\s*km/i);
            if (m && m[1]) distanceKm = `${m[1]} km`;
          }

          const rawLandingUrl = r.customer?.adClick?.landingUrl || null;
          const canonicalLandingUrl = resolveCanonicalLandingUrl(rawLandingUrl, tenantLandingDomain) || rawLandingUrl;

          const childName = (r.customer as any)?.children?.[0]?.name || null;

          return {
            id: r.id,
            status: r.status,
            eventType: 'Purchase',
            treatment_detail: sanitizedTreatmentDetail,
            raw_text: r.raw_text,
            child_name: childName,
            purchase_occurred_at: r.purchase_occurred_at || r.created_at,
            purchase_event_sent_at: r.purchase_event_sent_at,
            purchase_review_status: r.purchase_review_status || 'pending',
            value: value ?? 0,
            is_repeat_order: isRepeatOrder,
            order_number: orderNumber,
            customer_type: isRepeatOrder ? 'repeat' : 'new',
            distanceKm,
            customer: {
              id: r.customer?.id,
              name: r.customer?.name || 'Bunda',
              phone: r.customer?.phone || '',
              kota: r.customer?.kota || (r.customer as any)?.pending_kota || null,
              kecamatan: r.customer?.kecamatan || (r.customer as any)?.pending_kecamatan || null,
              zipcode: r.customer?.zipcode || (r.customer as any)?.pending_zipcode || null,
            },
            attribution: {
              isPaid: !!r.customer?.adClick,
              ctwa_clid: r.customer?.adClick?.ctwa_clid || null,
              trackingCode: r.customer?.adClick?.trackingCode || null,
              landingUrl: canonicalLandingUrl,
              fbp: r.customer?.adClick?.fbp || null,
              fbc: r.customer?.adClick?.fbc || null,
              fbclid: r.customer?.adClick?.fbclid || null,
              ipAddress: r.customer?.adClick?.ipAddress || null,
              userAgent: r.customer?.adClick?.userAgent || null,
            },
            utm: {
              campaign: r.customer?.adClick?.utmCampaign || null,
              source: r.customer?.adClick?.utmSource || null,
              medium: r.customer?.adClick?.utmMedium || null,
            },
            ageHours,
            daysOld,
            expiresInDays: Math.max(0, 7 - daysOld),
            metaDropRisk: daysOld > 7,
          };
        })
      );

      // Unsent MQL Leads + riwayat terkirim/ditolak (agar tidak lenyap pasca-moderasi)
      let mqlLeadItems: any[] = [];
      try {
        const leadAuditLogs = await prisma.auditLog.findMany({
          where: {
            tenant_id: tenantId,
            action: { in: ['MQL_LEAD_EVENT_SENT', 'MQL_LEAD_EVENT_REJECTED'] },
          },
          select: { target_id: true, action: true, created_at: true },
          orderBy: { created_at: 'desc' },
        });
        // leadAuditLogs diurutkan created_at DESC ΓåÆ log TERBARU dieksekusi admin
        // harus menang. Tanpa cek `has()`, iterasi akan menimpa dengan log TERTUA
        // (bug: aksi reject/outlier terbaru hilang).
        const sentMap = new Map<string, string>();
        for (const a of leadAuditLogs) {
          if (a.target_id && !sentMap.has(a.target_id)) {
            sentMap.set(a.target_id, a.action);
          }
        }
        const processedCustomerIds: string[] = Array.from(sentMap.keys());

        const unsentMqlCustomers = await prisma.customer.findMany({
          where: {
            tenant_id: tenantId,
            is_sandbox_test: false,
            phone: { not: { startsWith: '6289999' } },
            OR: [
              { is_mql: true },
              { mql_bubble_count: { gte: 5 } },
            ],
            id: { notIn: processedCustomerIds },
            // Anti-duplikasi Lead vs Purchase: customer yang SUDAH closing
            // (punya reservasi confirmed/en_route/completed) tidak dimoderasi
            // lagi sebagai Lead ΓÇö sudah terkonversi ke Purchase. Syarat berbasis
            // state DB (bukan string match), tahan terhadap paginasi/date-range.
            reservations: {
              none: {
                tenant_id: tenantId,
                status: { in: ['confirmed', 'en_route', 'completed'] },
              },
            },
          },
          include: {
            adClick: true,
          },
          orderBy: { created_at: 'desc' },
          take: 20,
        });

        mqlLeadItems = unsentMqlCustomers.map((c: any) => {
          const occurredDate = c.mql_triggered_at || c.created_at || new Date();
          const occurredAt = new Date(occurredDate).getTime();
          const ageMs = Math.max(0, now - occurredAt);
          const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
          const daysOld = Math.floor(ageMs / (24 * 60 * 60 * 1000));

          const rawLandingUrl = c.adClick?.landingUrl || null;
          const canonicalLandingUrl = resolveCanonicalLandingUrl(rawLandingUrl, tenantLandingDomain) || rawLandingUrl;

          return {
            id: `lead_${c.id}`,
            status: 'mql_lead',
            eventType: 'Lead',
            treatment_detail: 'Lead Prospek MQL (Percakapan Aktif)',
            raw_text: `Customer teridentifikasi MQL (${c.mql_bubble_count || 5}+ pesan)`,
            purchase_occurred_at: occurredDate,
            purchase_event_sent_at: null,
            purchase_review_status: 'pending',
            value: 0,
            distanceKm: c.distance_km ? `${c.distance_km} km` : null,
            customer: {
              name: c.name || 'Bunda',
              phone: c.phone || '',
            },
            attribution: {
              isPaid: !!c.adClick,
              ctwa_clid: c.adClick?.ctwa_clid || null,
              trackingCode: c.adClick?.trackingCode || null,
              landingUrl: canonicalLandingUrl,
            },
            utm: {
              campaign: c.adClick?.utmCampaign || null,
              source: c.adClick?.utmSource || null,
              medium: c.adClick?.utmMedium || null,
            },
            ageHours,
            daysOld,
            expiresInDays: Math.max(0, 7 - daysOld),
            metaDropRisk: daysOld > 7,
          };
        });
        // Riwayat MQL yang sudah dimoderasi (approved -> Terkirim, rejected -> ignored_outlier)
        if (processedCustomerIds.length > 0) {
          try {
            const processedCustomers = await prisma.customer.findMany({
              where: {
                tenant_id: tenantId,
                id: { in: processedCustomerIds.slice(0, 50) },
                // Sama seperti daftar unsent: sembunyikan baris Lead bagi customer
                // yang sudah closing (agar tidak tampil ganda Lead + Purchase).
                reservations: {
                  none: {
                    tenant_id: tenantId,
                    status: { in: ['confirmed', 'en_route', 'completed'] },
                  },
                },
              },
              include: { adClick: true },
            });
            for (const c of processedCustomers as any[]) {
              if (shouldExcludeFromCapiQueue((c as any).phone, (c as any).name, (c as any).is_sandbox_test)) continue;
              const action = sentMap.get(c.id);
              const isSent = action === 'MQL_LEAD_EVENT_SENT';
              const occurredDate = c.mql_triggered_at || c.created_at || new Date();
              const occurredAt = new Date(occurredDate).getTime();
              const ageMs = Math.max(0, now - occurredAt);
              const rawLandingUrl = (c as any).adClick?.landingUrl || null;
              const canonicalLandingUrl = resolveCanonicalLandingUrl(rawLandingUrl, tenantLandingDomain) || rawLandingUrl;
              mqlLeadItems.push({
                id: `lead_${c.id}`,
                status: 'mql_lead',
                eventType: 'Lead',
                treatment_detail: 'Lead Prospek MQL (Percakapan Aktif)',
                raw_text: `Customer teridentifikasi MQL (${(c as any).mql_bubble_count || 5}+ pesan)`,
                purchase_occurred_at: occurredDate,
                purchase_event_sent_at: isSent ? occurredDate : null,
                purchase_review_status: isSent ? 'approved' : 'ignored_outlier',
                value: 0,
                distanceKm: (c as any).distance_km ? `${(c as any).distance_km} km` : null,
                customer: { name: (c as any).name || 'Bunda', phone: (c as any).phone || '' },
                attribution: {
                  isPaid: !!(c as any).adClick,
                  ctwa_clid: (c as any).adClick?.ctwa_clid || null,
                  trackingCode: (c as any).adClick?.trackingCode || null,
                  landingUrl: canonicalLandingUrl,
                },
                utm: {
                  campaign: (c as any).adClick?.utmCampaign || null,
                  source: (c as any).adClick?.utmSource || null,
                  medium: (c as any).adClick?.utmMedium || null,
                },
                ageHours: Math.floor(ageMs / (60 * 60 * 1000)),
                daysOld: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
                expiresInDays: Math.max(0, 7 - Math.floor(ageMs / (24 * 60 * 60 * 1000))),
                metaDropRisk: Math.floor(ageMs / (24 * 60 * 60 * 1000)) > 7,
              });
            }
          } catch {}
        }
      } catch (leadErr) {
        console.warn('[CAPI QUEUE] Could not fetch unsent MQL leads:', leadErr);
      }

      const data = [...reservationData, ...mqlLeadItems];
      const pending = data.filter((d) => d.purchase_review_status === 'pending').length;

      return reply.status(200).send({ success: true, data, total: data.length, pending, wabaConfigured });
    } catch (err: any) {
      const rows = Array.from(memoryReservations.values()).filter(
        (r) => r.status !== 'cancelled'
          && !shouldExcludeFromCapiQueue((r as any).customer?.phone ?? (r as any).phone, (r as any).customer?.name ?? (r as any).name, (r as any).customer?.is_sandbox_test ?? (r as any).is_sandbox_test)
      );
      return reply.status(200).send({
        success: true,
        data: rows,
        total: rows.length,
        pending: rows.filter((r) => (r.purchase_review_status || 'pending') === 'pending').length,
        note: 'Fallback in-memory mode (DB offline)',
      });
    }
  });
}

export default reservationDispatchRoutes;
