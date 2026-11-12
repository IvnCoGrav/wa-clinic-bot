import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { tenantOf, sanitizeDurationMinutes } from './route-helpers';
import { auditService } from '../../services/audit.service';
import { alertService, AlertType, AlertSeverity } from '../../services/alert.service';
import { customerService } from '../../services/customer.service';
import { googleCalendarService } from '../../services/google-calendar.service';
import { resolvePurchaseReviewOnConfirm } from '../../services/capi-review-status';
import {
  extractBabyDetails,
  extractNotesFromRawText,
  mergeNotesIntoRawText,
  classifyPatientEntity,
} from '../../utils/reservation-text-parser';
import { isValidChildName } from '../../utils/name-sanitizer';
import { isPrematureCompletion } from '../../domain/reservation-status';
import { memoryReservations } from './stores';
import { resolveReservationPaymentEvaluation } from '../../services/reservation-core.service';
import { reservationArchiveService } from '../../services/reservation-archive.service';
import {
  reservationStatusService,
  InvalidTransitionError,
  PrematureCompletionError,
} from '../../services/reservation-status.service';

function withPaymentEvaluation(r: any) {
  if (!r) return r;
  return { ...r, paymentEvaluation: resolveReservationPaymentEvaluation(r) };
}

export async function reservationDispatchCrudRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/reservation/:id
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
            customer_address: true,
          },
        });
        if (!reservation) {
          const mem = memoryReservations.get(id);
          if (!mem || mem.tenant_id !== tenantId) return reply.status(404).send({ success: false, error: 'Reservation tidak ditemukan' });
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
            data: withPaymentEvaluation({
              ...mem,
              assigned_staff: memStaff,
              notes: (mem as any).notes || extractNotesFromRawText(mem.raw_text),
              baby_details: extractBabyDetails(mem.raw_text),
            }),
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
          data: withPaymentEvaluation({
            ...reservation,
            notes: (reservation as any).notes || extractNotesFromRawText(reservation.raw_text),
            baby_details: extractBabyDetails(reservation.raw_text),
            mom_gestational_info: resolveMomGestationalInfo({
              text: `${(reservation as any).raw_text || ''} ${(reservation as any).treatment_detail || ''}`,
              treatmentCategory: (reservation as any).treatment_category,
              registeredAt: (reservation as any).created_at,
              gestationalWeeks: (reservation as any).gestational_weeks,
              momStage: (reservation as any).mom_stage,
              hplDate: (reservation as any).hpl_date,
            }),
            customer: (reservation as any).customer
              ? { ...(reservation as any).customer, children: enrichedChildren }
              : undefined,
          }),
        });
      } catch (err: any) {
        const mem = memoryReservations.get(id);
        if (mem && mem.tenant_id === tenantId) {
          return reply.status(200).send({
            success: true,
            data: withPaymentEvaluation({
              ...mem,
              notes: (mem as any).notes || extractNotesFromRawText(mem.raw_text),
              baby_details: extractBabyDetails(mem.raw_text),
            }),
          });
        }
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation/:id
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
          discountAmount?: number | null;
          discount_amount?: number | null;
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
          landmark?: string;
          babies?: Array<{ name: string; ageText?: string }>;
          customerAddressId?: string | null;
          customer_address_id?: string | null;
          durationMinutes?: number | null;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      const rawBody = (request.body || {}) as any;
      const body: any = { ...rawBody };
      const dualCaseMap: Record<string, string> = {
        treatment_category: 'treatmentCategory',
        treatment_detail: 'treatmentDetail',
        booking_date: 'bookingDate',
        assigned_staff_id: 'assignedStaffId',
        purchase_value: 'purchaseValue',
        discount_amount: 'discountAmount',
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
        discountAmount,
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
          if (status !== undefined) {
            try {
              reservationStatusService.assertTransition(
                { ...mock, booking_date: completionMockDate },
                status,
                { force: (body as any)?.forceComplete }
              );
            } catch (err: any) {
              if (err instanceof InvalidTransitionError) {
                return reply.status(409).send({
                  success: false,
                  code: 'ILLEGAL_TRANSITION',
                  error: err.message,
                });
              }
              if (err instanceof PrematureCompletionError) {
                return reply.status(400).send({
                  success: false,
                  code: 'PREMATURE_COMPLETION_BLOCKED',
                  error: 'Reservasi masa depan tidak dapat ditandai sebagai completed sebelum tanggal kunjungan tiba. Gunakan forceComplete: true bila ada persetujuan darurat.',
                });
              }
              throw err;
            }
          }
          if (normalizedCat !== undefined) mock.treatment_category = normalizedCat;
          if (treatmentDetail !== undefined) mock.treatment_detail = treatmentDetail;
          if (purchaseValue !== undefined) mock.purchase_value = purchaseValue;
          if (discountAmount !== undefined) {
            const d = discountAmount === null ? null : Math.round(Number(discountAmount));
            if (d !== null && (!Number.isFinite(d) || d < 0)) {
              return reply.status(400).send({ success: false, error: 'discountAmount tidak valid.' });
            }
            const gross = purchaseValue !== undefined ? Number(purchaseValue) : Number(mock.purchase_value || 0);
            mock.discount_amount = d === null ? null : Math.min(d, Math.max(0, gross));
          }
          if (body.customerAddressId !== undefined || body.customer_address_id !== undefined) {
            const caId = body.customerAddressId !== undefined ? body.customerAddressId : body.customer_address_id;
            mock.customer_address_id = caId || null;
          }
          if (status === 'confirmed' && mock.status !== 'confirmed') {
            mock.purchase_review_status = resolvePurchaseReviewOnConfirm(mock as any);
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
        if (discountAmount !== undefined) {
          const d = discountAmount === null ? null : Math.round(Number(discountAmount));
          if (d !== null && (!Number.isFinite(d) || d < 0)) {
            return reply.status(400).send({ success: false, error: 'discountAmount tidak valid.' });
          }
          const gross = purchaseValue !== undefined ? Number(purchaseValue) : Number(existing.purchase_value || 0);
          updateData.discount_amount = d === null ? null : Math.min(d, Math.max(0, gross));
        }
        if (status !== undefined) {
          const targetBookingDate = bookingDate !== undefined
            ? (bookingDate ? new Date(bookingDate) : null)
            : existing.booking_date;
          try {
            reservationStatusService.assertTransition(
              { ...existing, booking_date: targetBookingDate },
              status,
              { force: (body as any)?.forceComplete }
            );
          } catch (err: any) {
            if (err instanceof InvalidTransitionError) {
              return reply.status(409).send({
                success: false,
                code: 'ILLEGAL_TRANSITION',
                error: err.message,
              });
            }
            if (err instanceof PrematureCompletionError) {
              return reply.status(400).send({
                success: false,
                code: 'PREMATURE_COMPLETION_BLOCKED',
                error: 'Reservasi masa depan tidak dapat ditandai sebagai completed sebelum tanggal kunjungan tiba. Gunakan forceComplete: true bila ada persetujuan darurat.',
              });
            }
            throw err;
          }
          updateData.status = status;
        }
        if (isBecomingConfirmed) {
          updateData.purchase_review_status = resolvePurchaseReviewOnConfirm(existing as any);
        }
        if (body.customerAddressId !== undefined || body.customer_address_id !== undefined) {
          const caId = body.customerAddressId !== undefined ? body.customerAddressId : body.customer_address_id;
          if (!caId) {
            updateData.customer_address_id = null;
          } else {
            let cards: any[] = [];
            try {
              cards = (await customerService.getSavedAddresses(existing.customer_id, tenantId)) as any[];
            } catch {
              cards = [];
            }
            const chosen = (Array.isArray(cards) ? cards : []).find((c: any) => c?.id === caId);
            if (!chosen) {
              return reply.status(400).send({
                success: false,
                code: 'CUSTOMER_ADDRESS_NOT_FOUND',
                error: 'Kartu alamat yang dipilih tidak ada di buku alamat customer ini.',
              });
            }
            updateData.customer_address_id = chosen.id;
            if (typeof chosen.ongkir === 'number') updateData.delivery_fee = chosen.ongkir;
          }
        }

        const hasExplicitAddressId =
          body.customerAddressId !== undefined
            ? body.customerAddressId === null || Boolean(body.customerAddressId)
            : body.customer_address_id !== undefined
              ? body.customer_address_id === null || Boolean(body.customer_address_id)
              : false;
        const hasExplicitCardSelection = Boolean(body.customerAddressId);
        if (address !== undefined && address !== null && String(address).trim() !== '' && existing.customer_id && !hasExplicitAddressId) {
          try {
            const { addressesMatch } = await import('../../domain/customer-address');
            const card: any = (existing as any).customer_address || null;
            const cust: any = (existing as any).customer || {};
            const sameHouse = card
              ? addressesMatch(
                  { address: card.address, kelurahan: card.kelurahan, kecamatan: card.kecamatan, kota: card.kota, lat: card.lat, lng: card.lng },
                  { address, kelurahan, kecamatan, kota }
                )
              : false;
            const entry = await customerService.upsertSavedAddress(existing.customer_id, {
              address: String(address).trim(),
              kelurahan: kelurahan ?? (sameHouse ? (card?.kelurahan ?? cust?.kelurahan ?? null) : null),
              kecamatan: kecamatan ?? (sameHouse ? (card?.kecamatan ?? cust?.kecamatan ?? null) : null),
              kota: kota ?? (sameHouse ? (card?.kota ?? cust?.kota ?? null) : null),
              lat: sameHouse ? (card?.lat ?? cust?.lat ?? null) : null,
              lng: sameHouse ? (card?.lng ?? cust?.lng ?? null) : null,
              distanceKm: sameHouse ? (card?.distance_km ?? card?.distanceKm ?? cust?.distance_km ?? null) : null,
              ongkir: sameHouse ? (card?.ongkir ?? cust?.ongkir ?? null) : null,
              locationSource: sameHouse ? (card?.location_source ?? card?.locationSource ?? cust?.location_source ?? null) : null,
              isPrimary: card ? (sameHouse ? (card?.is_primary ?? card?.isPrimary ?? true) : false) : true,
            }, tenantId);
            if (entry?.id) {
              updateData.customer_address_id = entry.id;
              if (typeof entry.ongkir === 'number') updateData.delivery_fee = entry.ongkir;
            }
          } catch (rc1Err: any) {
            console.warn('[Admin API] RC-1 address relink skipped (best-effort):', rc1Err?.message);
          }
        }

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

        if (!hasExplicitCardSelection && (body as any).ongkir !== undefined && (body as any).ongkir !== null && existing.customer_id) {
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

        const completionTargetDate = parsedBookingDate !== undefined ? parsedBookingDate : existing.booking_date;
        if (isBecomingCompleted && isPrematureCompletion(completionTargetDate) && !(body as any)?.forceComplete) {
          return reply.status(400).send({
            success: false,
            code: 'PREMATURE_COMPLETION_BLOCKED',
            error: 'Reservasi masa depan tidak dapat ditandai sebagai completed sebelum tanggal kunjungan tiba. Gunakan forceComplete: true bila ada persetujuan darurat.',
          });
        }

        if (isBecomingCompleted && !targetStaff && !(body as any)?.allowUnassignedStaff) {
          return reply.status(400).send({
            success: false,
            code: 'STAFF_ASSIGNMENT_REQUIRED',
            error: 'Reservasi tidak dapat diselesaikan tanpa penugasan bidan (assigned_staff_id). Tugaskan bidan terlebih dahulu atau sertakan allowUnassignedStaff: true.',
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
              const calEventId = await googleCalendarService.createEvent(updated, cName, tenantId);
              if (calEventId) {
                await prisma.reservation.update({ where: { id }, data: { google_calendar_event_id: calEventId } });
                (updated as any).google_calendar_event_id = calEventId;
              }
            } catch (gcErr: any) {
              console.error('[Admin API] Google Calendar Event create on edit failed:', gcErr.message);
            }
          }
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
              await googleCalendarService.deleteEvent(updated.google_calendar_event_id, tenantId);
              await prisma.reservation.update({ where: { id }, data: { google_calendar_event_id: null } }).catch(() => {});
            } catch (gcErr: any) {
              console.warn('[Admin API] Google Calendar delete on cancel failed:', gcErr.message);
            }
          }
        }
        if (staffChanged && assignedStaffId) {
          try {
            const { staffNotificationService } = await import('../../services/staff-notification.service');
            staffNotificationService.scheduleReservationAssignmentNotification(id, assignedStaffId).catch((err: any) => {
              console.error('[Admin API] Failed to schedule staff notification on edit:', err.message);
            });
            if (existing.assigned_staff_id && existing.assigned_staff_id !== assignedStaffId) {
              const newStaffName = (updated as any)?.assigned_staff?.name || undefined;
              const oldStaffWasNotified = (existing as any).assignment_notified_at != null;
              staffNotificationService.sendTaskUnassignedNotification(id, existing.assigned_staff_id, newStaffName, oldStaffWasNotified).catch((err: any) => {
                console.warn('[Admin API] Failed to send unassigned notification to old staff:', err.message);
              });
            }
          } catch (err: any) {
            console.warn('[Admin API] staffNotification import failed:', err.message);
          }
        }

        if (staffChanged) {
          try {
            const p = prisma.reservationStaffAssignmentLog?.create({
              data: {
                tenant_id: tenantId,
                reservation_id: id,
                from_staff_id: existing.assigned_staff_id || null,
                to_staff_id: assignedStaffId || null,
                reason: (body as any)?.assignmentReason || (body as any)?.reason || 'admin_edit',
                actor: (request as any).adminUser?.name || (request as any).staffName || (request as any).adminIdentity || 'admin',
              },
            });
            void Promise.resolve(p).catch((err: any) => {
              console.warn('[STAFF-ASSIGN-LOG] Failed to create log on edit:', err.message);
              alertService.notifyAlert({
                type: AlertType.STAFF_ASSIGNMENT_LOG_FAILED,
                severity: AlertSeverity.WARNING,
                message: `[STAFF-ASSIGN-LOG] Gagal membuat log penugasan staf (edit): ${err.message}`,
                metadata: { reservationId: id, tenantId, toStaffId: assignedStaffId },
              }).catch(() => {});
            });
          } catch (err: any) {
            console.warn('[STAFF-ASSIGN-LOG] Exception initiating log on edit:', err.message);
            alertService.notifyAlert({
              type: AlertType.STAFF_ASSIGNMENT_LOG_FAILED,
              severity: AlertSeverity.WARNING,
              message: `[STAFF-ASSIGN-LOG] Exception pembuatan log penugasan staf (edit): ${err.message}`,
              metadata: { reservationId: id, tenantId, toStaffId: assignedStaffId },
            }).catch(() => {});
          }
        }

        if (existing.customer_id) {
          try {
            await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId);
          } catch (ltvErr: any) {
            console.warn('[Admin API] Failed to recalculate LTV on edit:', ltvErr.message);
          }
        }

        if (existing.customer_id && (customerName || customerPhone || address || kecamatan || kota || kelurahan || landmark)) {
          if (customerName) {
            try {
              await customerService.updateCustomerName(existing.customer_id, customerName, tenantId, { source: 'admin', force: true });
            } catch (_) {}
          }
          const custUpdate: any = {};
          if (customerPhone) custUpdate.phone = customerPhone.replace(/\D/g, '');
          if (!hasExplicitCardSelection) {
            if (kecamatan) custUpdate.kecamatan = kecamatan;
            if (kota) custUpdate.kota = kota;
            if (kelurahan) custUpdate.kelurahan = kelurahan;
          }
          if ((address || landmark) && !hasExplicitCardSelection) {
            try {
              await customerService.mergeCustomerPreferences(existing.customer_id, tenantId, {
                ...(address ? { address } : {}),
                ...(landmark ? { landmark } : {}),
              });
            } catch (mergeErr: any) {
              console.warn(
                '[Admin API] Failed to merge customer preferences on reservation patch:',
                mergeErr?.message
              );
            }
          }
          if (Object.keys(custUpdate).length > 0) {
            try {
              await prisma.customer.update({
                where: { id: existing.customer_id, tenant_id: tenantId },
                data: custUpdate,
              });
            } catch (err: any) {
              console.warn('[Admin API] Failed to update customer extra details on reservation patch:', err?.message || err);
            }
          }
        }

        if (existing.customer_id && Array.isArray(babies) && babies.length > 0) {
          const { parseAgeTextToBirthDate, monthsBetween } = await import('../../utils/age-calculator');
          for (const b of babies) {
            if (!b.name) continue;
            const nm = String((b as any).name || '').trim();
            if (!nm || !isValidChildName(nm)) continue;
            if (classifyPatientEntity({ name: nm, ageText: (b as any).ageText }) !== 'CHILD') continue;
            const newBirthDate = b.ageText ? parseAgeTextToBirthDate(b.ageText, new Date()) : null;
            const existingChild = existing.customer?.children?.find((c: any) => c.name.toLowerCase() === nm.toLowerCase());
            if (existingChild) {
              const updateData: any = { raw_age_text: b.ageText || existingChild.raw_age_text, last_reservation_id: id };
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
                  name: nm,
                  name_norm: nm.trim().toLowerCase(),
                  first_reservation_id: id,
                  last_reservation_id: id,
                  raw_age_text: b.ageText || '',
                  birth_date: newBirthDate,
                  age_months_at_registration: newBirthDate ? monthsBetween(newBirthDate, new Date()) : null,
                },
              });
            }
          }
        }

        if (updated.google_calendar_event_id && parsedBookingDate) {
          try {
            const cName = customerName || existing.customer?.name || 'Bunda';
            await googleCalendarService.updateEvent(updated.google_calendar_event_id, updated, cName, tenantId);
          } catch (gcErr) {
            console.error('[Admin API] Google Calendar Event update failed:', gcErr);
          }
        }

        if (parsedBookingDate) {
          try {
            const { followUpService } = await import('../../services/follow-up.service');
            await followUpService.onReservationRescheduled(id, parsedBookingDate, existing.tenant_id || tenantId);
          } catch (fuErr: any) {
            console.warn('[Admin API] Failed to reschedule follow-ups on reservation edit:', fuErr.message);
          }
        }

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

        if (purchaseValue !== undefined || status !== undefined) {
          try {
            await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId);
          } catch (ltvErr: any) {
            console.warn('[Admin API] Failed to recalculate ltv_cache on reservation edit:', ltvErr.message);
          }
        }

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
            if (existing?.customer) {
              reservationResponse = {
                ...reservationResponse,
                customer: existing.customer,
              };
            }
          }
        } catch (err: any) {
          console.warn('[Admin API] Failed to re-fetch full relations on reservation patch:', err.message);
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
   * DELETE /api/admin/reservation/:id
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
        const isArchive = !isSoftCancel;

        if (isArchive) {
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

        if (existing.google_calendar_event_id) {
          try {
            await googleCalendarService.deleteEvent(existing.google_calendar_event_id, tenantId);
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

        try {
          const { followUpService } = await import('../../services/follow-up.service');
          await followUpService.onReservationCancelled(id, existing.tenant_id || tenantId);
        } catch (_) {}

        if (existing.assigned_staff_id) {
          const cancelReason = reason || undefined;
          import('../../services/staff-notification.service').then(({ staffNotificationService }) => {
            staffNotificationService.sendReservationCancelledNotification(id, existing.assigned_staff_id!, cancelReason).catch((e: any) =>
              console.warn('[Admin API] Failed to send Telegram cancelled (soft delete):', e.message)
            );
          }).catch(() => {});
        }

        await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId).catch(() => {});

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
