import { reservationStatusService } from './reservation-status.service';
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { customerService } from './customer.service';
import { isValidChildName } from '../utils/name-sanitizer';
import { classifyPatientEntity } from '../utils/reservation-text-parser';
import { ConflictCheckUnavailableError } from './reservation-core.service';
import { PURCHASE_REVIEW_NOT_APPLICABLE } from './capi-review-status';

export interface CreateSeriesParams {
  customerId: string;
  treatmentName: string;
  treatmentCategory?: string;
  totalSessions: number;
  purchaseValue?: number;
  deliveryFee?: number;
  assignedStaffId?: string;
  notes?: string;
  paymentMethod?: string;
  discountAmount?: number;
  durationMinutes?: number;
  requestId?: string;
  /** Kartu alamat level series (satu rumah untuk semua sesi). */
  customerAddressId?: string;
  sessions: Array<{
    sessionNumber: number;
    bookingDate: Date | string;
    assignedStaffId?: string;
    durationMinutes?: number;
    customerAddressId?: string | null;
  }>;
  babies?: Array<{ name: string; ageText?: string }>;
  force?: boolean;
}

export interface SeriesWithReservations {
  id: string;
  customerId: string;
  treatmentName: string;
  totalSessions: number;
  completedSessions: number;
  pendingSessions: number;
  purchaseValue: number | null;
  deliveryFee?: number | null;
  discountAmount?: number | null;
  paymentMethod?: string | null;
  durationMinutes?: number | null;
  customerAddressId?: string | null;
  requestId?: string | null;
  status: string;
  assignedStaffId: string | null;
  notes: string | null;
  createdAt: Date;
  reservations: Array<{
    id: string;
    sessionNumber: number;
    bookingDate: Date;
    status: string;
    assignedStaffId: string | null;
  }>;
}

class ReservationSeriesService {
  /**
   * Helper: Resolve treatment category dynamically from catalog or keywords
   */
  private async resolveCategory(treatmentName: string, explicitCategory?: string): Promise<'BABY' | 'MOMS' | 'BOTH'> {
    if (explicitCategory) {
      const upper = explicitCategory.toUpperCase();
      if (upper === 'MOMS' || upper === 'POSTPARTUM' || upper === 'PREGNANCY') return 'MOMS';
      if (upper === 'BOTH' || upper === 'BUNDLE') return 'BOTH';
      return 'BABY';
    }

    try {
      const { treatmentCatalogService } = await import('./treatment-catalog.service');
      const all = (treatmentCatalogService as any).getAllServices?.() || [];
      const found = all.find((s: any) => s.name?.toLowerCase() === treatmentName.toLowerCase() || treatmentName.toLowerCase().includes(s.name?.toLowerCase()));
      if (found?.category) {
        const cat = found.category.toUpperCase();
        if (cat === 'MOMS' || cat === 'POSTPARTUM' || cat === 'PREGNANCY') return 'MOMS';
        if (cat === 'BOTH' || cat === 'BUNDLE') return 'BOTH';
        return 'BABY';
      }
    } catch {}

    const nameLower = (treatmentName || '').toLowerCase();
    if (nameLower.includes('moms') || nameLower.includes('ibu') || nameLower.includes('hamil') || nameLower.includes('nifas') || nameLower.includes('postpartum') || nameLower.includes('laktasi')) {
      return 'MOMS';
    }
    if (nameLower.includes('combo') || nameLower.includes('both') || (nameLower.includes('ibu') && nameLower.includes('anak'))) {
      return 'BOTH';
    }
    return 'BABY';
  }

  /**
   * Bentuk respons kanonis series (dipakai createSeries & jalur idempoten).
   */
  private mapSeriesToResult(series: any, reservations?: any[]): SeriesWithReservations {
    const resList = reservations || series.reservations || [];
    const completedSessions = resList.filter((r: any) => r.status === 'completed').length;
    const pendingSessions = resList.filter(
      (r: any) => r.status === 'pending' || r.status === 'confirmed'
    ).length;

    return {
      id: series.id,
      customerId: series.customer_id,
      treatmentName: series.treatment_name,
      totalSessions: series.total_sessions,
      completedSessions,
      pendingSessions,
      purchaseValue: series.purchase_value,
      deliveryFee: series.delivery_fee,
      discountAmount: series.discount_amount,
      paymentMethod: series.payment_method,
      durationMinutes: series.duration_minutes,
      customerAddressId: series.customer_address_id,
      requestId: series.request_id,
      status: series.status,
      assignedStaffId: series.assigned_staff_id,
      notes: series.notes,
      createdAt: series.created_at,
      reservations: resList.map((r: any) => ({
        id: r.id,
        sessionNumber: r.session_number!,
        bookingDate: r.booking_date!,
        status: r.status,
        assignedStaffId: r.assigned_staff_id,
      })),
    };
  }

  /**
   * Create a reservation series with N auto-generated reservations.
   */
  async createSeries(params: CreateSeriesParams, tenantId: string = DEFAULT_TENANT_ID): Promise<SeriesWithReservations> {
    const {
      customerId,
      treatmentName,
      treatmentCategory,
      totalSessions,
      purchaseValue,
      deliveryFee,
      assignedStaffId,
      notes,
      paymentMethod,
      discountAmount,
      durationMinutes,
      requestId,
      customerAddressId,
      sessions,
      force,
    } = params;

    if (sessions.length !== totalSessions) {
      throw new Error(`sessions array length (${sessions.length}) tidak sama dengan totalSessions (${totalSessions})`);
    }

    // Idempotensi (anti klik-ganda): request_id sama => kembalikan series yang sudah ada.
    if (requestId && requestId.trim()) {
      const existing = await prisma.reservationSeries.findFirst({
        where: { tenant_id: tenantId, request_id: requestId.trim() },
        include: { reservations: { orderBy: { session_number: 'asc' } } },
      });
      if (existing) return this.mapSeriesToResult(existing);
    }

    const resolvedCategory = await this.resolveCategory(treatmentName, treatmentCategory);
    const sanitizedStaffId = assignedStaffId?.trim() ? assignedStaffId.trim() : null;
    const seriesDuration = durationMinutes && durationMinutes > 0 ? durationMinutes : 60;
    const sessionDurationOf = (s: { durationMinutes?: number }) => s.durationMinutes ?? seriesDuration;

    // Validasi deterministik tanggal sesi (format & masa lalu).
    for (const s of sessions) {
      const bookingDate = typeof s.bookingDate === 'string' ? new Date(s.bookingDate) : s.bookingDate;
      if (!bookingDate || isNaN(bookingDate.getTime())) {
        const err: any = new Error('INVALID_SESSION_DATE');
        err.code = 'INVALID_SESSION_DATE';
        err.sessionNumber = s.sessionNumber;
        throw err;
      }
      if (!force && bookingDate.getTime() < Date.now() - 5 * 60 * 1000) {
        const err: any = new Error('PAST_SESSION_DATE');
        err.code = 'PAST_SESSION_DATE';
        err.sessionNumber = s.sessionNumber;
        throw err;
      }
    }

    // Sesi dalam paket yang sama tidak boleh saling tumpang tindih.
    for (let i = 0; i < sessions.length; i++) {
      for (let j = i + 1; j < sessions.length; j++) {
        const d1 = new Date(sessions[i].bookingDate).getTime();
        const d2 = new Date(sessions[j].bookingDate).getTime();
        if (Math.abs(d1 - d2) < sessionDurationOf(sessions[j]) * 60000) {
          const err: any = new Error('CUSTOMER_COLLISION');
          err.code = 'CUSTOMER_COLLISION';
          err.sessionNumber = sessions[j].sessionNumber;
          err.conflict = { reason: 'Sesi dalam paket saling tumpang tindih' };
          throw err;
        }
      }
    }

    const {
      computeAdvisoryLockKey,
      findOverlappingStaffReservations,
      findOverlappingCustomerReservations,
      hasCapacityForUnassignedBooking,
      resolveCustomerAddressId,
    } = await import('./reservation-core.service');

    // Satu kartu level series (rekomendasi D2). Jika API lama mengirim kartu
    // per-sesi, semua sesi WAJIB sama — DILARANG menebak salah satu.
    const sessionCardIds = [
      ...new Set(
        sessions
          .map((s) => (typeof s.customerAddressId === 'string' ? s.customerAddressId.trim() : ''))
          .filter((id) => id.length > 0)
      ),
    ];
    if (sessionCardIds.length > 1) {
      const err: any = new Error('Series hanya boleh memakai satu kartu alamat untuk semua sesi.');
      err.code = 'SERIES_MULTIPLE_ADDRESS_NOT_SUPPORTED';
      throw err;
    }

    const requestedCardId = customerAddressId?.trim() || sessionCardIds[0] || null;
    let resolvedAddressCard: Awaited<ReturnType<typeof customerService.resolveOwnedAddressCard>> = null;
    let resolvedAddressId: string | null = null;

    if (requestedCardId) {
      resolvedAddressCard = await customerService.resolveOwnedAddressCard(customerId, requestedCardId, tenantId);
      if (!resolvedAddressCard) {
        const err: any = new Error('Kartu alamat yang dipilih tidak ada di buku alamat customer ini.');
        err.code = 'CUSTOMER_ADDRESS_NOT_FOUND';
        throw err;
      }
      resolvedAddressId = resolvedAddressCard.id;
    } else {
      resolvedAddressId = await resolveCustomerAddressId({
        tenantId,
        customerId,
        candidate: undefined,
      });
    }

    const resolvedDeliveryFee =
      typeof resolvedAddressCard?.ongkir === 'number' ? resolvedAddressCard.ongkir : null;
    // Ongkir eksplisit menang; jika tidak dikirim, pakai snapshot kartu alamat level series.
    const effectiveDeliveryFee = deliveryFee != null ? deliveryFee : resolvedDeliveryFee;

    const result = await prisma.$transaction(async (tx: any) => {
      if (typeof tx.$executeRawUnsafe === 'function') {
        const lockKeys = [
          ...new Set(
            sessions.map((s) =>
              computeAdvisoryLockKey(
                tenantId,
                (s.assignedStaffId?.trim() || sanitizedStaffId) || null,
                typeof s.bookingDate === 'string' ? new Date(s.bookingDate) : s.bookingDate
              )
            )
          ),
        ].sort((a, b) => a - b);

        for (const key of lockKeys) {
          await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1)', key);
        }
      } else if (process.env.NODE_ENV === 'production' && process.env.ALLOW_ADVISORY_LOCK_FALLBACK !== 'true') {
        throw new ConflictCheckUnavailableError('advisory_lock', 'Advisory lock unavailable on series transaction');
      }

      for (const s of sessions) {
        const sessionStaffId = s.assignedStaffId?.trim() ? s.assignedStaffId.trim() : sanitizedStaffId;
        const bookingDate = typeof s.bookingDate === 'string' ? new Date(s.bookingDate) : s.bookingDate;
        const duration = s.durationMinutes ?? seriesDuration;

        if (sessionStaffId) {
          const staffConflicts = await findOverlappingStaffReservations({
            tenantId, staffId: sessionStaffId, bookingDate, durationMinutes: duration, db: tx,
          });
          if (staffConflicts.length > 0) {
            const err: any = new Error('STAFF_COLLISION');
            err.code = 'STAFF_COLLISION';
            err.conflict = staffConflicts[0];
            err.sessionNumber = s.sessionNumber;
            throw err;
          }
        }

        const { exactConflicts } = await findOverlappingCustomerReservations({
          tenantId, customerId, bookingDate, durationMinutes: duration, db: tx,
        });
        if (exactConflicts && exactConflicts.length > 0) {
          const err: any = new Error('DUPLICATE_BOOKING');
          err.code = 'DUPLICATE_BOOKING';
          err.conflict = exactConflicts[0];
          err.sessionNumber = s.sessionNumber;
          throw err;
        }

        // Sesi tanpa terapis: pastikan masih ada kapasitas terapis pada tanggal tersebut.
        if (!sessionStaffId) {
          const hasCapacity = await hasCapacityForUnassignedBooking(tenantId, bookingDate, tx);
          if (!hasCapacity) {
            const err: any = new Error('CAPACITY_EXCEEDED');
            err.code = 'CAPACITY_EXCEEDED';
            err.sessionNumber = s.sessionNumber;
            throw err;
          }
        }
      }

      const series = await tx.reservationSeries.create({
        data: {
          tenant_id: tenantId,
          customer_id: customerId,
          treatment_name: treatmentName,
          total_sessions: totalSessions,
          purchase_value: purchaseValue ?? null,
          delivery_fee: effectiveDeliveryFee,
          discount_amount: discountAmount ?? null,
          payment_method: paymentMethod ?? null,
          duration_minutes: seriesDuration,
          customer_address_id: resolvedAddressId,
          request_id: requestId?.trim() || null,
          assigned_staff_id: sanitizedStaffId,
          notes: notes ?? null,
          status: 'active',
        },
      });

      const reservations = await Promise.all(
        sessions.map(async (s) => {
          const bookingDate = typeof s.bookingDate === 'string' ? new Date(s.bookingDate) : s.bookingDate;
          const sessionStaffId = s.assignedStaffId?.trim() ? s.assignedStaffId.trim() : sanitizedStaffId;
          const duration = s.durationMinutes ?? seriesDuration;
          const perSessionPrice = purchaseValue ? Math.round(purchaseValue / totalSessions) : null;
          const created = await tx.reservation.create({
            data: {
              tenant_id: tenantId,
              customer_id: customerId,
              treatment_category: resolvedCategory,
              treatment_detail: `${treatmentName} [Sesi ${s.sessionNumber}/${totalSessions}]`,
              booking_date: bookingDate,
              duration_minutes: duration,
              status: 'confirmed',
              // CAPI single-anchor: hanya sesi 1 paket yang boleh membawa event komersial.
              purchase_review_status: s.sessionNumber === 1 ? 'pending' : PURCHASE_REVIEW_NOT_APPLICABLE,
              assigned_staff_id: sessionStaffId,
              purchase_value: perSessionPrice,
              series_id: series.id,
              session_number: s.sessionNumber,
              total_sessions: totalSessions,
              customer_address_id: resolvedAddressId,
              // KB-6: snapshot ongkir dari kartu level series (bukan root).
              delivery_fee: effectiveDeliveryFee,
              discount_amount: discountAmount ? Math.round(discountAmount / totalSessions) : null,
              payment_method: paymentMethod ?? null,
              raw_text: `[Admin Series] ${treatmentName} - Sesi ${s.sessionNumber}/${totalSessions}`,
            },
          });
          if (tx.reservationItem) {
            await tx.reservationItem.create({
              data: {
                tenant_id: tenantId,
                reservation_id: created.id,
                custom_name: treatmentName,
                price: perSessionPrice ?? 0,
                duration_minutes: duration,
              },
            });
          }
          return created;
        })
      );

      return this.mapSeriesToResult(series, reservations);
    });

    // Sync babies if provided (same upsert logic as single reservation edit)
    if (params.babies && params.babies.length > 0) {
      const { parseAgeTextToBirthDate, monthsBetween } = await import('../utils/age-calculator');
      const firstResId = result.reservations[0]?.id || null;
      const lastResId = result.reservations[result.reservations.length - 1]?.id || firstResId;
      for (const b of params.babies) {
        if (!b.name) continue;
        const nm = String(b.name || '').trim();
        if (!nm || !isValidChildName(nm)) continue;
        if (classifyPatientEntity({ name: nm, ageText: (b as any).ageText }) !== 'CHILD') continue;
        try {
          // Koreksi admin umur WAJIB menghitung ulang birth_date (paritas jalur
          // edit customer) — bukan hanya raw_age_text.
          const newBirthDate = b.ageText ? parseAgeTextToBirthDate(b.ageText, new Date()) : null;
          const existingChild = await prisma.child.findFirst({
            where: { customer_id: customerId, name: { equals: nm, mode: 'insensitive' } },
          });
          if (existingChild) {
            const updateData: any = { raw_age_text: b.ageText || existingChild.raw_age_text, last_reservation_id: lastResId };
            if (newBirthDate) {
              updateData.birth_date = newBirthDate;
              updateData.age_months_at_registration = monthsBetween(newBirthDate, new Date());
            }
            await prisma.child.update({ where: { id: existingChild.id }, data: updateData });
          } else {
            await prisma.child.create({
              data: {
                tenant_id: tenantId,
                customer_id: customerId,
                name: nm,
                name_norm: nm.trim().toLowerCase(),
                first_reservation_id: firstResId,
                last_reservation_id: lastResId,
                raw_age_text: b.ageText || '',
                birth_date: newBirthDate,
                age_months_at_registration: newBirthDate ? monthsBetween(newBirthDate, new Date()) : null,
              },
            });
          }
        } catch (e: any) {
          console.warn('[RESERVATION SERIES] Failed to sync baby:', e.message);
        }
      }
    }

    // Sync customer LTV cache after series reservations are created
    try {
      await customerService.recalculateCustomerLtv(customerId, tenantId);
    } catch (err: any) {
      console.warn('[RESERVATION SERIES] recalculateCustomerLtv on create failed:', err.message);
    }

    // FIX 173i-e: jalankan efek samping kanonis per sesi (sebelumnya series
    // bypass lifecycle → follow-up H-1/H+1 & notifikasi penugasan staf hilang
    // senyap). Best-effort: kegagalan satu sesi tidak menggagalkan series.
    for (const r of result.reservations) {
      try {
        const { reservationLifecycleService } = await import('./reservation-lifecycle.service');
        // Kontrak lifecycle memakai BabyDetail { name, age }. Series menerima
        // { name, ageText? } → map agar tipe konsisten (ageText kosong → '').
        await reservationLifecycleService.onReservationCreated({
          customerId,
          reservationId: r.id,
          tenantId,
          chatId: '',
          babies: (params.babies || []).map((b) => ({ name: b.name, age: b.ageText || '' })),
        });
      } catch (lcErr: any) {
        console.warn(`[RESERVATION SERIES] lifecycle sesi ${r.sessionNumber} warning:`, lcErr?.message);
      }

      try {
        const { followUpService } = await import('./follow-up.service');
        await followUpService.createReservationFollowUps({
          reservationId: r.id,
          customerId,
          bookingDate: r.bookingDate,
          treatmentCategory: resolvedCategory,
          tenantId,
        });
      } catch (fuErr: any) {
        console.warn(`[RESERVATION SERIES] follow-up sesi ${r.sessionNumber} warning:`, fuErr?.message);
      }

      if (r.assignedStaffId) {
        try {
          const { staffNotificationService } = await import('./staff-notification.service');
          await staffNotificationService.scheduleReservationAssignmentNotification(r.id, r.assignedStaffId);
        } catch (notifErr: any) {
          console.warn(`[RESERVATION SERIES] notifikasi staf sesi ${r.sessionNumber} warning:`, notifErr?.message);
        }
      }
    }

    // Best-effort background Google Calendar sync (createEvent per session)
    try {
      const { googleCalendarService } = await import('./google-calendar.service');
      const { prisma: gCalPrisma } = await import('../db/client');
      for (const r of result.reservations) {
        if (r.bookingDate) {
          const reservation = await gCalPrisma.reservation.findUnique({ where: { id: r.id } }).catch(() => null);
          const customer = reservation ? await gCalPrisma.customer.findUnique({ where: { id: customerId } }).catch(() => null) : null;
          const name = customer?.name || 'Bunda';
          if (reservation) (googleCalendarService as any).createEvent?.(reservation, name, tenantId).catch(() => {});
        }
      }
    } catch {}

    return result;
  }

  /**
   * Get a single series with all its reservations.
   */
  async getSeries(seriesId: string, tenantId: string = DEFAULT_TENANT_ID) {
    const series = await prisma.reservationSeries.findFirst({
      where: { id: seriesId, tenant_id: tenantId },
      include: {
        reservations: { orderBy: { session_number: 'asc' } },
        customer: { select: { id: true, name: true, phone: true } },
        assigned_staff: { select: { id: true, name: true } },
      },
    });
    if (!series) return null;

    const completedSessions = series.reservations.filter((r) => r.status === 'completed').length;
    const pendingSessions = series.reservations.filter((r) => r.status === 'pending' || r.status === 'confirmed').length;

    return {
      ...series,
      completed_sessions: completedSessions,
      pending_sessions: pendingSessions,
    };
  }

  /**
   * Get all active series for a customer.
   */
  async getCustomerSeries(customerId: string, tenantId: string = DEFAULT_TENANT_ID) {
    const list = await prisma.reservationSeries.findMany({
      where: { customer_id: customerId, tenant_id: tenantId, status: { notIn: ['cancelled'] } },
      include: {
        reservations: { orderBy: { session_number: 'asc' } },
        assigned_staff: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return list.map((series) => {
      const completedSessions = series.reservations.filter((r) => r.status === 'completed').length;
      const pendingSessions = series.reservations.filter((r) => r.status === 'pending' || r.status === 'confirmed').length;
      return {
        ...series,
        completed_sessions: completedSessions,
        pending_sessions: pendingSessions,
      };
    });
  }

  /**
   * Update a single session's booking date or staff.
   */
  async updateSession(
    reservationId: string,
    data: { bookingDate?: Date | string; assignedStaffId?: string | null; status?: string },
    tenantId: string = DEFAULT_TENANT_ID
  ) {
    const updateData: any = {};
    if (data.bookingDate !== undefined) {
      updateData.booking_date = typeof data.bookingDate === 'string' ? new Date(data.bookingDate) : data.bookingDate;
    }
    if (data.assignedStaffId !== undefined) {
      updateData.assigned_staff_id = data.assignedStaffId?.trim() ? data.assignedStaffId.trim() : null;
    }
    if (data.status !== undefined) {
      updateData.status = data.status;
    }

    // Guard bentrok staf (paritas jalur utama) — hanya saat reassign ke jadwal aktif.
    if (updateData.assigned_staff_id) {
      const current = await prisma.reservation.findFirst({
        where: { id: reservationId, tenant_id: tenantId },
        select: { booking_date: true, status: true, duration_minutes: true },
      });
      const targetDate = updateData.booking_date ?? current?.booking_date ?? null;
      const targetStatus = updateData.status ?? current?.status;
      if (current && targetDate && targetStatus !== 'cancelled') {
        const { findOverlappingStaffReservations } = await import('./reservation-core.service');
        const conflicts = await findOverlappingStaffReservations({
          tenantId,
          staffId: updateData.assigned_staff_id,
          bookingDate: targetDate,
          durationMinutes: current.duration_minutes ?? 60,
          excludeId: reservationId,
        });
        if (conflicts.length > 0) {
          const err: any = new Error('STAFF_COLLISION');
          err.code = 'STAFF_COLLISION';
          err.conflict = conflicts[0];
          throw err;
        }
      }
    }

    const updated = await prisma.reservation.update({
      where: { id: reservationId, tenant_id: tenantId },
      data: updateData,
    });

    if (data.status !== undefined && updated.customer_id) {
      try {
        await customerService.recalculateCustomerLtv(updated.customer_id, tenantId);
      } catch (err: any) {
        console.warn('[RESERVATION SERIES] recalculateCustomerLtv on updateSession failed:', err.message);
      }
    }

    // Sinkronkan jadwal ulang ke follow-up (reminder) dan Google Calendar.
    if (data.bookingDate !== undefined && updated.booking_date) {
      try {
        const { followUpService } = await import('./follow-up.service');
        const { googleCalendarService } = await import('./google-calendar.service');
        await followUpService.onReservationRescheduled(updated.id, updated.booking_date, tenantId);
        await (googleCalendarService as any).updateEvent?.(updated)?.catch?.(() => {});
      } catch (e: any) {
        console.warn('[RESERVATION SERIES] error rescheduling follow-up/gcal on updateSession:', e?.message);
      }
    }

    return updated;
  }

  /**
   * Pause all remaining sessions in a series (set status to 'paused').
   */
  async pauseSeries(seriesId: string, tenantId: string = DEFAULT_TENANT_ID) {
    const series = await prisma.reservationSeries.findFirst({
      where: { id: seriesId, tenant_id: tenantId },
      include: { reservations: true },
    });
    if (!series) throw new Error('Series not found');

    const pendingReservations = series.reservations.filter(
      (r) => r.status === 'pending' || r.status === 'confirmed'
    );

    await prisma.$transaction(async (tx: any) => {
      await tx.reservationSeries.update({
        where: { id: seriesId },
        data: { status: 'paused' },
      });
      for (const r of pendingReservations) {
        await reservationStatusService.applyTransition(r, {
          to: 'paused',
          db: tx,
        });
      }
    });

    return { pausedCount: pendingReservations.length };
  }

  /**
   * Resume a paused series (set remaining sessions back to pending).
   */
  async resumeSeries(seriesId: string, tenantId: string = DEFAULT_TENANT_ID) {
    const series = await prisma.reservationSeries.findFirst({
      where: { id: seriesId, tenant_id: tenantId },
      include: { reservations: true },
    });
    if (!series) throw new Error('Series not found');

    const pausedReservations = series.reservations.filter((r) => r.status === 'paused');

    await prisma.$transaction(async (tx: any) => {
      await tx.reservationSeries.update({
        where: { id: seriesId },
        data: { status: 'active' },
      });
      for (const r of pausedReservations) {
        await reservationStatusService.applyTransition(r, {
          to: 'confirmed',
          db: tx,
        });
      }
    });

    return { resumedCount: pausedReservations.length };
  }

  /**
   * Cancel remaining sessions in a series.
   */
  async cancelSeries(seriesId: string, tenantId: string = DEFAULT_TENANT_ID) {
    const series = await prisma.reservationSeries.findFirst({
      where: { id: seriesId, tenant_id: tenantId },
      include: { reservations: true },
    });
    if (!series) throw new Error('Series not found');

    const cancellable = series.reservations.filter(
      (r) => r.status === 'pending' || r.status === 'confirmed' || r.status === 'paused'
    );

    await prisma.$transaction(async (tx: any) => {
      await tx.reservationSeries.update({
        where: { id: seriesId },
        data: { status: 'cancelled' },
      });
      for (const r of cancellable) {
        await reservationStatusService.applyTransition(r, {
          to: 'cancelled',
          db: tx,
        });
      }
    });

    // Sync LTV cache after cancelling series
    try {
      await customerService.recalculateCustomerLtv(series.customer_id, tenantId);
    } catch (err: any) {
      console.warn('[RESERVATION SERIES] recalculateCustomerLtv on cancel failed:', err.message);
    }

    // Sinkronkan pembatalan ke follow-up dan Google Calendar untuk setiap sesi
    // yang dibatalkan (cegah reminder "kaset rusak" untuk sesi yang sudah batal).
    try {
      const { followUpService } = await import('./follow-up.service');
      const { googleCalendarService } = await import('./google-calendar.service');
      for (const r of cancellable) {
        await followUpService.onReservationCancelled(r.id, tenantId).catch(() => {});
        if (r.google_calendar_event_id) {
          await googleCalendarService.deleteEvent(r.google_calendar_event_id).catch(() => {});
        }
      }
    } catch (e: any) {
      console.warn('[RESERVATION SERIES] error cancelling follow-ups/gcal on cancelSeries:', e?.message);
    }

    return { cancelledCount: cancellable.length };
  }

  /**
   * Auto-mark series as completed when all sessions are done.
   */
  async checkAndCompleteSeries(seriesId: string, tenantId: string = DEFAULT_TENANT_ID) {
    const series = await prisma.reservationSeries.findFirst({
      where: { id: seriesId, tenant_id: tenantId },
      include: { reservations: true },
    });
    if (!series || series.status !== 'active') return;

    const allCompleted = series.reservations.every((r) => r.status === 'completed' || r.status === 'cancelled');
    if (allCompleted) {
      await prisma.reservationSeries.update({
        where: { id: seriesId },
        data: { status: 'completed' },
      });
    }
  }
}

export const reservationSeriesService = new ReservationSeriesService();

